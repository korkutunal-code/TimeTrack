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
