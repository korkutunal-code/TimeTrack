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

import type { TimeSegment } from './database';

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
