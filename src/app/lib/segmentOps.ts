/**
 * Punch segment operations — pure functions, no firebase dependency.
 *
 * Owns the TimeSegment mutation logic for the Clock Agent. Imported by
 * clockService.ts (which does the actual Firestore writes) and by jest tests
 * (which can import these without needing a firebase emulator).
 *
 * Why this file exists: the previous version of these helpers lived in
 * database.ts alongside the firebase-firestore imports. That made them
 * impossible to unit-test in jest (firebase's web SDK throws on import in
 * node without an emulator). Splitting them out keeps the pure logic pure.
 */

import type { TimeEntry, TimeSegment } from './database';

/**
 * Strip undefined values from an object. Firestore rejects any field with
 * value `undefined` (it errors with "Unsupported field value: undefined"),
 * so we strip them before passing to `setDoc` / `updateDoc`. This is a known
 * foot-gun: callers often spread `...entry` and pick up optional fields.
 */
export function stripUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(obj) as (keyof T)[]) {
    if (obj[k] !== undefined) out[k] = obj[k] as any;
  }
  return out;
}

/** Create a fresh open segment for a new punch-in. */
export function createInitialSegment(clockInManual: string, clockInSystem: number, taskId?: string): TimeSegment {
  const seg: TimeSegment = {
    id: `seg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    clockInManual,
    clockInSystem,
    complete: false,
  };
  if (taskId) seg.taskId = taskId; // omit if not set, never write undefined
  return seg;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/** Close an open segment with clock-out + compute its workMinutes (lunch-aware, simple). */
export function closeActiveSegment(
  seg: TimeSegment,
  clockOutManual: string,
  clockOutSystem: number,
  skipLunch = false
): TimeSegment {
  if (seg.complete) return seg; // idempotent

  const inM = timeToMinutes(seg.clockInManual || '00:00');
  const outM = timeToMinutes(clockOutManual);
  let workM = Math.max(0, outM - inM);

  if (!skipLunch && seg.lunchOutManual && seg.lunchInManual) {
    const lo = timeToMinutes(seg.lunchOutManual);
    const li = timeToMinutes(seg.lunchInManual);
    workM -= Math.max(0, li - lo);
  }

  const out: TimeSegment = {
    ...seg,
    clockOutManual,
    clockOutSystem,
    workMinutes: workM,
    complete: true,
    skipLunch: skipLunch || seg.skipLunch,
  };
  return out;
}

/** Apply a lunch action to an open segment (start or end). Returns updated segment copy. */
export function applyLunchToSegment(
  seg: TimeSegment,
  action: 'start' | 'end' | 'skip',
  timeManual: string,
  timeSystem: number
): TimeSegment {
  if (seg.complete) return seg;
  if (action === 'skip') {
    const out: TimeSegment = { ...seg, skipLunch: true };
    return out;
  }
  if (action === 'start' && !seg.lunchOutManual) {
    return { ...seg, lunchOutManual: timeManual, lunchOutSystem: timeSystem };
  }
  if (action === 'end' && seg.lunchOutManual && !seg.lunchInManual) {
    return { ...seg, lunchInManual: timeManual, lunchInSystem: timeSystem };
  }
  return seg;
}

/**
 * Returns the currently-active (open, not yet clocked-out) segment, if any.
 *
 * Reads from `entry.segments[]` first (the canonical split-shift source). If
 * segments is empty but the entry has legacy `clockInManual` set and no
 * `clockOutManual`, synthesizes a current segment from the legacy top-level
 * fields. This handles the case where a clock-in was written by the legacy
 * `TodayEntry` UI (which only writes top-level fields, no `segments[]`).
 *
 * Also returns `entry.currentSegment` (the synthesized view exposed by
 * `mapEntry`) when the persisted segments are empty.
 */
export function getActiveSegment(entry: TimeEntry | null | undefined): TimeSegment | null {
  if (!entry) return null;

  // Voided/archived entries have no active shift. The legacy 1-entry-per-day
  // rule and the punchIn validator both need to treat these as "no open
  // shift" so test data cleanup (soft-voiding old docs) can recover state
  // without manually rewriting segments[].
  if (entry.status === 'voided' || entry.status === 'archived') return null;

  // Canonical: an open segment in the persisted array.
  if (entry.segments?.length) {
    const last = entry.segments[entry.segments.length - 1];
    if (last && !last.complete) return last;
  }

  // Fallback 1: synthesized current view from mapEntry (used when the doc has
  // BOTH legacy fields and segments[] that we deliberately excluded).
  const cur = (entry as any).currentSegment as TimeSegment | null | undefined;
  if (cur && !cur.complete) return cur;

  // Fallback 2: legacy half-baked doc (clockInManual written, no segments, no
  // currentSegment because mapEntry sees no clockInManual either). Build a
  // minimal open segment so the UI and validation recognize this as an open
  // shift. This is the case where the user clocked in via the legacy
  // TodayEntry form which only writes top-level fields.
  if (entry.clockInManual && !entry.clockOutManual && !entry.complete) {
    return {
      id: `${entry.id || entry.userId || 'unknown'}_legacy_current`,
      clockInManual: entry.clockInManual,
      clockInSystem: entry.clockInSystem,
      complete: false,
    };
  }

  return null;
}

/** True if the day has any open (in-progress) segment. */
export function hasOpenSegment(entry: TimeEntry | null | undefined): boolean {
  return getActiveSegment(entry) !== null;
}
