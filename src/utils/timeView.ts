/**
 * Admin timezone view conversion (Req 4).
 *
 * Admin/Manager analysis views (Payroll, History, Audit, Metrics, Team) can
 * render shift times in either:
 *   - "local": the EMPLOYEE's own local timezone (default), or
 *   - "pt":    America/Los_Angeles (California Time), for administrative review.
 *
 * The conversion uses the absolute epoch-millis system timestamps
 * (clockInSystem / clockOutSystem / lunchOutSystem / lunchInSystem), which are
 * timezone-independent. The HH:MM *Manual strings are used only as a fallback
 * for legacy rows that lack system timestamps (they are already stored in the
 * entry's own zone, so they are shown as-is).
 *
 * Pure functions (no firebase) so they are jest-testable.
 */

import { getEmployeeTimezone } from './timeCalculations';

export type TimeViewMode = 'local' | 'pt';

export const PT_ZONE = 'America/Los_Angeles';

/** Resolve the IANA zone for a view mode. 'pt' → PT; 'local' → employee tz. */
export function zoneForMode(mode: TimeViewMode, employeeTimezone?: string | null): string {
  return mode === 'pt' ? PT_ZONE : getEmployeeTimezone(employeeTimezone ?? undefined);
}

/** HH:MM (24h) of an instant in the given zone. */
export function hhmmInZone(epochMs: number, zone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(epochMs));
}

/** HH:MM (12h AM/PM) of an instant in the given zone. */
export function hhmm12InZone(epochMs: number, zone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(epochMs));
}

/**
 * Display a single boundary time for the given view mode, as a 24h "HH:MM"
 * string (composable with the views' existing HH:MM→12h renderers).
 * - `epochMs`: the absolute system timestamp for the boundary (preferred).
 * - `manualFallback`: the stored HH:MM string (used when epochMs is absent).
 * - `mode`: 'local' | 'pt'.
 * - `employeeTimezone`: the employee's local zone (for 'local' mode).
 * Returns a 24h "HH:MM" string, or the fallback when no time exists.
 */
export function displayTimeForView(
  epochMs: number | undefined,
  manualFallback: string | undefined,
  mode: TimeViewMode,
  employeeTimezone?: string | null,
): string | undefined {
  if (typeof epochMs === 'number') {
    return hhmmInZone(epochMs, zoneForMode(mode, employeeTimezone));
  }
  return manualFallback;
}

// ---------------------------------------------------------------------------
// Per-local-date explosion (cross-midnight split attribution)
// ---------------------------------------------------------------------------

export interface ExplodableSegment {
  id?: string;
  localDate?: string;
  workMinutes?: number;
  complete?: boolean;
  clockInManual?: string;
  clockOutManual?: string;
  clockInSystem?: number;
  clockOutSystem?: number;
}

export interface ExplodableDoc {
  id?: string;
  userId?: string;
  date?: string;
  workDate?: string;
  segments?: ExplodableSegment[];
  currentSegment?: ExplodableSegment | null;
  clockInManual?: string;
  clockOutManual?: string;
  clockInSystem?: number;
  clockOutSystem?: number;
  complete?: boolean;
  totalWorkMinutes?: number;
  totalHours?: number;
}

/**
 * Split a doc whose persisted segments carry attributed `localDate`s (written
 * by the automatic local-midnight split) into one synthetic doc per local
 * calendar date. This repairs the pre-fix cross-midnight shape, where a
 * 23:32→00:28 shift was split into 23:32→23:59 + 00:00→00:28 but BOTH parts
 * were stored on the punch-in day's doc — causing triple rows in the edit
 * modal (the synthesized top-level "current" 23:32→00:28 appeared as a third
 * shift) and single-day aggregation in payroll/history.
 *
 * Docs whose segments have no differing localDate are returned unchanged
 * (zero impact on normal single-day or same-day split-shift docs). Works on
 * hydrated TimeEntry objects and raw Firestore DocumentData alike.
 */
export function explodeDocBySegmentLocalDate<T extends ExplodableDoc>(doc: T): T[] {
  const segs = doc.segments ?? [];
  const fallbackDate = doc.workDate ?? doc.date;
  const dates: string[] = [];
  for (const s of segs) {
    const d = s.localDate ?? fallbackDate;
    if (d && !dates.includes(d)) dates.push(d);
  }
  if (dates.length <= 1) return [doc];
  return dates.map((date) => {
    const dateSegs = segs.filter((s) => (s.localDate ?? fallbackDate) === date);
    const mins = dateSegs.reduce((sum, s) => sum + (s.workMinutes ?? 0), 0);
    const first = dateSegs[0];
    const lastClosed = [...dateSegs].reverse().find((s) => s.clockOutManual) ?? dateSegs[dateSegs.length - 1];
    return {
      ...doc,
      id: doc.userId ? `${doc.userId}_${date}` : doc.id,
      date,
      workDate: date,
      segments: dateSegs,
      // Each exploded doc stands alone for its date; drop the synthesized
      // top-level "current" view so it cannot appear as a phantom extra shift.
      currentSegment: undefined,
      clockInManual: first?.clockInManual,
      clockOutManual: lastClosed?.clockOutManual,
      clockInSystem: first?.clockInSystem,
      clockOutSystem: lastClosed?.clockOutSystem,
      complete: dateSegs.length > 0 && dateSegs.every((s) => s.complete === true),
      totalWorkMinutes: mins,
      totalHours: mins / 60,
    } as T;
  });
}

/** Explode a list of docs (see explodeDocBySegmentLocalDate). */
export function explodeDocsBySegmentLocalDate<T extends ExplodableDoc>(docs: T[]): T[] {
  return docs.flatMap((d) => explodeDocBySegmentLocalDate(d));
}
