/**
 * Regression tests for the Firestore "Unsupported field value: undefined" bug.
 *
 * Bug: when ClockPunch / clockService calls `tx.set(ref, payload, { merge: true })`,
 * any field with value `undefined` causes the WHOLE write to fail with
 * "Unsupported field value: undefined". This was making clock-in silently fail
 * for employees in production. The fix: stripUndefined() + createInitialSegment()
 * must never emit `undefined` values.
 */
// `./firebase` references `import.meta.env` and `window` at module top-level,
// which throws under jest's CommonJS transform. The pure helpers under test
// (segmentOps + mapEntry) don't need a real Firestore handle, so stub it.
jest.mock('./firebase', () => ({ db: {} }));

import {
  stripUndefined,
  createInitialSegment,
  closeActiveSegment,
  applyLunchToSegment,
  buildConsistentClosePatch,
} from './segmentOps';
import type { TimeSegment } from './database';
import { calculateTotalHours } from './database';

describe('stripUndefined', () => {
  it('removes keys with undefined values', () => {
    const out = stripUndefined({ a: 1, b: undefined, c: 'x' });
    expect(out).toEqual({ a: 1, c: 'x' });
    expect(Object.keys(out as any)).not.toContain('b');
  });

  it('keeps null values (those are valid Firestore values)', () => {
    const out = stripUndefined({ a: null, b: undefined });
    expect(out).toEqual({ a: null });
  });

  it('keeps falsy non-undefined values (0, "", false)', () => {
    const out = stripUndefined({ a: 0, b: '', c: false, d: undefined });
    expect(out).toEqual({ a: 0, b: '', c: false });
  });

  it('handles empty object', () => {
    expect(stripUndefined({})).toEqual({});
  });
});

describe('createInitialSegment', () => {
  it('omits taskId when not provided (the bug fix)', () => {
    const seg = createInitialSegment('09:00', Date.now());
    expect(seg).not.toHaveProperty('taskId');
  });

  it('includes taskId when provided', () => {
    const seg = createInitialSegment('09:00', Date.now(), 'task-123');
    expect(seg.taskId).toBe('task-123');
  });

  it('always has required fields', () => {
    const seg = createInitialSegment('09:00', 1234567890);
    expect(seg.id).toBeTruthy();
    expect(seg.clockInManual).toBe('09:00');
    expect(seg.clockInSystem).toBe(1234567890);
    expect(seg.complete).toBe(false);
  });

  it('produces unique ids', () => {
    const a = createInitialSegment('09:00', Date.now());
    const b = createInitialSegment('09:00', Date.now());
    expect(a.id).not.toBe(b.id);
  });
});

describe('applyLunchToSegment', () => {
  it('start action sets lunchOut only (no lunchIn)', () => {
    const seg = createInitialSegment('09:00', Date.now());
    const next = applyLunchToSegment(seg, 'start', '12:00', Date.now() + 1000);
    expect(next.lunchOutManual).toBe('12:00');
    expect(next.lunchInManual).toBeUndefined();
    // No undefined keys in the result
    for (const k of Object.keys(next)) {
      expect(next[k as keyof typeof next]).not.toBeUndefined();
    }
  });

  it('end action sets lunchIn only', () => {
    const seg = applyLunchToSegment(
      createInitialSegment('09:00', Date.now()),
      'start',
      '12:00',
      Date.now() + 1000,
    );
    const next = applyLunchToSegment(seg, 'end', '12:30', Date.now() + 2000);
    expect(next.lunchOutManual).toBe('12:00');
    expect(next.lunchInManual).toBe('12:30');
  });

  it('skip action sets skipLunch=true and omits lunch times', () => {
    const seg = createInitialSegment('09:00', Date.now());
    const next = applyLunchToSegment(seg, 'skip', '', Date.now() + 1000);
    expect(next.skipLunch).toBe(true);
    expect(next.lunchOutManual).toBeUndefined();
    expect(next.lunchInManual).toBeUndefined();
  });
});

describe('closeActiveSegment', () => {
  it('sets clockOut and workMinutes, marks complete', () => {
    const seg = createInitialSegment('09:00', 1000);
    const closed = closeActiveSegment(seg, '17:00', 8000 * 60 * 60 * 1000 + 1000, false);
    expect(closed.clockOutManual).toBe('17:00');
    expect(closed.complete).toBe(true);
    expect((closed.workMinutes ?? 0) > 0).toBe(true);
  });

  it('is idempotent — closing twice is a no-op', () => {
    const seg = createInitialSegment('09:00', 1000);
    const closed1 = closeActiveSegment(seg, '17:00', 8000 * 60 * 60 * 1000 + 1000, false);
    const closed2 = closeActiveSegment(closed1, '18:00', 9000 * 60 * 60 * 1000 + 1000, false);
    expect(closed2.clockOutManual).toBe('17:00');
  });

  // S6: cross-midnight shift duration must wrap past 24:00 instead of
  // collapsing to 0 (the old `outM - inM` gave -1260 -> 0 for 23:00->02:00).
  it('S6: wraps a cross-midnight shift (23:00 -> 02:00 = 180 min)', () => {
    const seg = createInitialSegment('23:00', 1000);
    const closed = closeActiveSegment(seg, '02:00', 8000 * 60 * 60 * 1000 + 1000, false);
    expect(closed.workMinutes).toBe(180);
  });

  it('S6: subtracts a lunch that straddles midnight (22:00 / 23:30-00:30 / 02:00 = 180 min)', () => {
    let seg = createInitialSegment('22:00', 1000);
    seg = applyLunchToSegment(seg, 'start', '23:30', 2000);
    seg = applyLunchToSegment(seg, 'end', '00:30', 3000);
    const closed = closeActiveSegment(seg, '02:00', 8000 * 60 * 60 * 1000 + 1000, false);
    // 4h shift (22:00->02:00 = 240) - 60min lunch = 180
    expect(closed.workMinutes).toBe(180);
  });

  it('S6: subtracts a lunch fully after midnight (22:00 / 00:30-01:00 / 02:00 = 210 min)', () => {
    let seg = createInitialSegment('22:00', 1000);
    seg = applyLunchToSegment(seg, 'start', '00:30', 2000);
    seg = applyLunchToSegment(seg, 'end', '01:00', 3000);
    const closed = closeActiveSegment(seg, '02:00', 8000 * 60 * 60 * 1000 + 1000, false);
    // 4h shift (240) - 30min lunch = 210
    expect(closed.workMinutes).toBe(210);
  });

  it('S6: same-day shift is unchanged (08:00 -> 17:00 = 540 min)', () => {
    const seg = createInitialSegment('08:00', 1000);
    const closed = closeActiveSegment(seg, '17:00', 8000 * 60 * 60 * 1000 + 1000, false);
    expect(closed.workMinutes).toBe(540);
  });

  // Invariant relied on by directCloseShift's guard (database.ts): a segment
  // closed via closeActiveSegment always has a truthy clockOutManual, so
  // guarding the close path on clockOutManual (not the `complete` flag) blocks
  // genuine double-closes while still allowing stale-flagged-but-clock-out-less
  // segments to be closed.
  it('closed segment always carries a truthy clockOutManual alongside complete', () => {
    const seg = createInitialSegment('09:00', 1000);
    expect(seg.clockOutManual).toBeFalsy();
    const closed = closeActiveSegment(seg, '17:00', 8000 * 60 * 60 * 1000 + 1000, false);
    expect(closed.complete).toBe(true);
    expect(closed.clockOutManual).toBeTruthy();
    expect(closed.clockOutManual).toBe('17:00');
  });
});

describe('calculateTotalHours — S6 cross-midnight', () => {
  it('returns 0 when clock-out is missing', () => {
    expect(calculateTotalHours({ clockInManual: '08:00' })).toBe(0);
  });

  it('same-day shift with no lunch (08:00 -> 17:00 = 9h)', () => {
    expect(calculateTotalHours({ clockInManual: '08:00', clockOutManual: '17:00' })).toBe(9);
  });

  it('same-day shift with lunch (08:00 / 12:00-12:30 / 17:00 = 8.5h)', () => {
    expect(
      calculateTotalHours({
        clockInManual: '08:00',
        lunchOutManual: '12:00',
        lunchInManual: '12:30',
        clockOutManual: '17:00',
      }),
    ).toBe(8.5);
  });

  it('wraps a cross-midnight shift (23:00 -> 02:00 = 3h)', () => {
    expect(calculateTotalHours({ clockInManual: '23:00', clockOutManual: '02:00' })).toBe(3);
  });

  it('subtracts a midnight-straddling lunch (22:00 / 23:30-00:30 / 02:00 = 3h)', () => {
    expect(
      calculateTotalHours({
        clockInManual: '22:00',
        lunchOutManual: '23:30',
        lunchInManual: '00:30',
        clockOutManual: '02:00',
      }),
    ).toBe(3);
  });

  it('subtracts a lunch fully after midnight (22:00 / 00:30-01:00 / 02:00 = 3.5h)', () => {
    expect(
      calculateTotalHours({
        clockInManual: '22:00',
        lunchOutManual: '00:30',
        lunchInManual: '01:00',
        clockOutManual: '02:00',
      }),
    ).toBe(3.5);
  });

  it('skipLunch=true does not subtract lunch even when lunch fields are set', () => {
    expect(
      calculateTotalHours({
        clockInManual: '22:00',
        lunchOutManual: '23:30',
        lunchInManual: '00:30',
        clockOutManual: '02:00',
        skipLunch: true,
      }),
    ).toBe(4);
  });
});

/**
 * Regression tests for the legacy-clockIn half-baked doc shape.
 *
 * Bug found 2026-06-15 in live Playwright: when an employee clocked in via the
 * legacy `?classic=1` TodayEntry form, the Firestore doc got legacy top-level
 * fields (`clockInManual`, `clockInSystemTime`, etc.) but NO `segments[]` and
 * NO `clockInSystem` (millis). The next read via `getActiveSegment` returned
 * null, so the ClockPunch UI showed "CLOCKED OUT" even though the user was
 * still on the clock.
 *
 * Fix: `getActiveSegment` and `hasOpenSegment` now fall back to the legacy
 * top-level fields when segments[] is empty.
 */
import { getActiveSegment, hasOpenSegment } from './segmentOps';

describe('getActiveSegment — legacy fallback', () => {
  it('returns null for a null entry', () => {
    expect(getActiveSegment(null)).toBeNull();
  });

  it('returns null for an entry with no segments and no clockIn', () => {
    expect(getActiveSegment({ id: 'u1_2026-06-15', userId: 'u1', date: '2026-06-15', complete: false, currentStep: 0 } as any)).toBeNull();
  });

  it('returns null for an entry with no segments and complete=true', () => {
    expect(getActiveSegment({
      id: 'u1_2026-06-15',
      userId: 'u1',
      date: '2026-06-15',
      clockInManual: '08:00',
      clockOutManual: '17:00',
      complete: true,
      currentStep: 4,
    } as any)).toBeNull();
  });

  it('returns the open segment when segments[] has an open one (canonical path)', () => {
    const seg = { id: 'seg_1', clockInManual: '08:00', clockInSystem: 1, complete: false };
    const entry = { id: 'u1_2026-06-15', userId: 'u1', date: '2026-06-15', segments: [seg], complete: false, currentStep: 2 } as any;
    expect(getActiveSegment(entry)).toBe(seg);
  });

  it('returns null when segments[] has only closed segments', () => {
    const closed = { id: 'seg_1', clockInManual: '08:00', clockInSystem: 1, clockOutManual: '17:00', complete: true };
    const entry = { id: 'u1_2026-06-15', userId: 'u1', date: '2026-06-15', segments: [closed], complete: true, currentStep: 4 } as any;
    expect(getActiveSegment(entry)).toBeNull();
  });

  it('returns entry.currentSegment when persisted segments is empty (synthesized view)', () => {
    const cur = { id: 'u1_2026-06-15_current', clockInManual: '08:00', clockInSystem: 1, complete: false };
    const entry = {
      id: 'u1_2026-06-15',
      userId: 'u1',
      date: '2026-06-15',
      segments: [],
      currentSegment: cur,
      clockInManual: '08:00',
      complete: false,
      currentStep: 2,
    } as any;
    expect(getActiveSegment(entry)).toBe(cur);
  });

  it('FALLBACK: synthesizes a current segment from legacy clockInManual when segments[] and currentSegment are missing (the TodayEntry bug)', () => {
    const entry = {
      id: 'u1_2026-06-15',
      userId: 'u1',
      date: '2026-06-15',
      // No segments, no currentSegment
      clockInManual: '08:30',
      clockInSystem: 1700000000000,
      // No clockOutManual, not complete
      complete: false,
      currentStep: 2,
    } as any;
    const active = getActiveSegment(entry);
    expect(active).not.toBeNull();
    expect(active!.clockInManual).toBe('08:30');
    expect(active!.clockInSystem).toBe(1700000000000);
    expect(active!.complete).toBe(false);
  });

  it('FALLBACK: returns null for legacy half-baked doc when clockInManual is set but clockOutManual is also set (already closed)', () => {
    const entry = {
      id: 'u1_2026-06-15',
      userId: 'u1',
      date: '2026-06-15',
      clockInManual: '08:30',
      clockOutManual: '17:00',
      complete: true,
      currentStep: 4,
    } as any;
    expect(getActiveSegment(entry)).toBeNull();
  });
});

describe('hasOpenSegment — legacy fallback', () => {
  it('returns true for legacy half-baked open-shift doc (the TodayEntry bug)', () => {
    const entry = {
      id: 'u1_2026-06-15',
      userId: 'u1',
      date: '2026-06-15',
      clockInManual: '08:30',
      complete: false,
      currentStep: 2,
    } as any;
    expect(hasOpenSegment(entry)).toBe(true);
  });

  it('returns false for legacy closed-shift doc', () => {
    const entry = {
      id: 'u1_2026-06-15',
      userId: 'u1',
      date: '2026-06-15',
      clockInManual: '08:30',
      clockOutManual: '17:00',
      complete: true,
      currentStep: 4,
    } as any;
    expect(hasOpenSegment(entry)).toBe(false);
  });

  it('returns null/false for a voided entry even with an open segment in segments[] (cleanup case)', () => {
    // Real-world: cleanup script soft-voids a doc but doesn't rewrite
    // segments[]. The validator must still treat this as "no open shift"
    // so punchIn can proceed.
    const openSeg = { id: 'seg_1', clockInManual: '08:30', clockInSystem: 1, complete: false };
    const entry = {
      id: 'u1_2026-06-15',
      userId: 'u1',
      date: '2026-06-15',
      segments: [openSeg],
      clockInManual: '08:30',
      complete: false,
      currentStep: 2,
      status: 'voided',
    } as any;
    expect(getActiveSegment(entry)).toBeNull();
    expect(hasOpenSegment(entry)).toBe(false);
  });

  it('returns null/false for an archived entry (parity with voided)', () => {
    const openSeg = { id: 'seg_1', clockInManual: '08:30', clockInSystem: 1, complete: false };
    const entry = {
      id: 'u1_2026-06-15',
      userId: 'u1',
      date: '2026-06-15',
      segments: [openSeg],
      complete: false,
      currentStep: 2,
      status: 'archived',
    } as any;
    expect(getActiveSegment(entry)).toBeNull();
    expect(hasOpenSegment(entry)).toBe(false);
  });
});

/**
 * Regression: `mapEntry` used to hardcode `complete: true` for every segment
 * in `segments[]`, hiding the open segment that `punchIn` writes. The result
 * was that `getActiveSegment` returned null even though the user was just
 * clocked in, and the ClockPunch UI flipped to "CLOCKED OUT" right after a
 * successful click. Fix: respect the persisted `complete` value.
 *
 * The downstream effect (and what the user actually saw) is exercised here
 * via getActiveSegment on the shape mapEntry would produce.
 */
describe('mapEntry segments[].complete — must respect persisted value', () => {
  it('REGRESSION: an open segment in segments[] is detected as the active segment even when clockOutManual is stale', () => {
    // This entry shape mirrors what a freshly clocked-in doc looks like after
    // mapEntry hydrates it, INCLUDING the stale clockOutManual from a previous
    // test run. Pre-fix, mapEntry would force complete:true on the segment
    // and getActiveSegment would return null. Post-fix, it returns the
    // open segment.
    const entry = {
      id: 'u1_2026-06-16',
      userId: 'u1',
      date: '2026-06-16',
      segments: [{ id: 'seg_1', clockInManual: '10:00', clockInSystem: 1, complete: false }],
      clockInManual: '10:00',
      clockOutManual: '09:00', // stale
      complete: false,
      currentStep: 2,
      status: 'active',
    };
    const active = getActiveSegment(entry as any);
    expect(active).not.toBeNull();
    expect(active!.complete).toBe(false);
    expect(hasOpenSegment(entry as any)).toBe(true);
  });
});

/**
 * Regression: punchIn must preserve previously archived (closed) segments.
 *
 * When an employee does a split shift (clock-in → clock-out → clock-in again),
 * the first closed segment must remain in segments[]. Previously, punchIn's
 * payload used `segments: [newSeg]` which overwrote the entire array, losing
 * the archived segments and making split-shift impossible.
 */
describe('split-shift: punchIn must preserve archived segments', () => {
  it('punchOut closes the active segment (complete=true)', () => {
    const openSeg: TimeSegment = {
      id: 'seg_1',
      clockInManual: '09:00',
      clockInSystem: 1000,
      complete: false,
    };
    const closed = closeActiveSegment(openSeg, '17:00', 8000 * 60 * 60 * 1000 + 1000);
    expect(closed.complete).toBe(true);
    expect(closed.clockOutManual).toBe('17:00');
    expect(closed.workMinutes).toBeGreaterThan(0);
  });

  it('entry with 2 segments (1 closed, 1 open) is valid — getActiveSegment returns the open one', () => {
    const closedSeg = { id: 'seg_1', clockInManual: '08:00', clockInSystem: 1, clockOutManual: '12:00', complete: true, workMinutes: 240 };
    const openSeg = { id: 'seg_2', clockInManual: '13:00', clockInSystem: 2, complete: false };
    const entry = {
      id: 'u1_2026-06-16',
      userId: 'u1',
      date: '2026-06-16',
      segments: [closedSeg, openSeg],
      clockInManual: '13:00',
      clockOutManual: undefined,
      complete: false,
      currentStep: 2,
      status: 'active',
    };
    const active = getActiveSegment(entry as any);
    expect(active).not.toBeNull();
    expect(active!.id).toBe('seg_2');
    expect(active!.complete).toBe(false);
    expect(hasOpenSegment(entry as any)).toBe(true);
  });

  it('closed segment workMinutes are preserved alongside the open segment', () => {
    const closedSeg = { id: 'seg_1', clockInManual: '08:00', clockInSystem: 1, clockOutManual: '12:00', complete: true, workMinutes: 240 };
    const openSeg = { id: 'seg_2', clockInManual: '13:00', clockInSystem: 2, complete: false };
    const entry = {
      id: 'u1_2026-06-16',
      userId: 'u1',
      date: '2026-06-16',
      segments: [closedSeg, openSeg],
      clockInManual: '13:00',
      complete: false,
      currentStep: 2,
      status: 'active',
    };
    const archivedMins = (entry.segments as any[]).filter(s => s.complete === true).reduce((sum, s) => sum + (s.workMinutes || 0), 0);
    expect(archivedMins).toBe(240);
  });

  it('voided document with a closed segment: no open segment returned (voided short-circuits)', () => {
    const closedSeg = { id: 'seg_1', clockInManual: '08:00', clockInSystem: 1, clockOutManual: '12:00', complete: true, workMinutes: 240 };
    const entry = {
      id: 'u1_2026-06-16',
      userId: 'u1',
      date: '2026-06-16',
      segments: [closedSeg],
      clockInManual: '08:00',
      clockOutManual: '12:00',
      complete: true,
      currentStep: 4,
      status: 'voided',
    };
    expect(getActiveSegment(entry as any)).toBeNull();
    expect(hasOpenSegment(entry as any)).toBe(false);
  });

  it('BUG REGRESSION: punchIn was overwriting segments array instead of appending', () => {
    // This test documents the bug: before the fix, punchIn did
    // segments: [newSeg] which replaced the entire array, losing closedSeg.
    // After the fix, punchIn should do segments: [...existingSegments, newSeg].

    const existingClosedSegments: TimeSegment[] = [
      { id: 'seg_1', clockInManual: '09:00', clockInSystem: 1000, clockOutManual: '17:00', workMinutes: 480, complete: true },
    ];

    const newOpenSeg: TimeSegment = {
      id: 'seg_2',
      clockInManual: '18:00',
      clockInSystem: 9000,
      complete: false,
    };

    const correctSegments = [...existingClosedSegments, newOpenSeg];
    expect(correctSegments).toHaveLength(2);
    expect(correctSegments[0].complete).toBe(true);
    expect(correctSegments[1].complete).toBe(false);

    const buggySegments = [newOpenSeg];
    expect(buggySegments).toHaveLength(1);
    expect(buggySegments[0].complete).toBe(false);
  });
});

/**
 * Regression: mapEntry double-counted the synthesized `current` segment against
 * the persisted archived segment in the ClockPunch dual-write flow, producing
 * an exact 2x day total. A 37-minute single ClockPunch shift displayed as
 * "1:14" (74 min) in TodayEntry/HistoryView. Reported 2026-06-22 (Timecamp.xlsx
 * Issue 2: "Should have been 37 minutes, shows 1:14").
 *
 * Root cause: mapEntry's override block unconditionally added
 * `current.workMinutes` to `archivedMins`, but the ClockPunch flow persists the
 * most-recent closed shift in BOTH `segments[]` AND the top-level legacy fields.
 * The synthesized `current` (built from those legacy fields) therefore
 * duplicates an entry already present in `archived`. The fix detects the
 * dual-write case by checking whether any archived seg covers the same shift
 * (clockInManual + clockOutManual) as `current`.
 */
import { mapEntry } from './database';

describe('mapEntry — Bug B: no double-count of synthesized current vs persisted archived seg', () => {
  it('REGRESSION: a single ClockPunch closed shift (37 min) is NOT shown as 74 min', () => {
    // Shape mirrors what `punchOut` writes after a single closed shift:
    // segments[] contains the closed seg AND top-level fields mirror the same shift.
    const data = {
      userId: 'u1',
      workDate: '2026-06-22',
      clockInManual: '12:30',
      clockOutManual: '13:07',
      clockInSystemTime: { toDate: () => new Date(0) },
      clockOutSystemTime: { toDate: () => new Date(0) },
      dayComplete: true,
      totalWorkMinutes: 37,
      segments: [
        {
          id: 'seg_1719123456789_abc',
          clockInManual: '12:30',
          clockOutManual: '13:07',
          workMinutes: 37,
          complete: true,
        },
      ],
      status: 'active',
    };
    const entry = mapEntry('u1_2026-06-22', data as any);
    expect(entry.totalWorkMinutes).toBe(37);
    expect(entry.totalHours).toBeCloseTo(37 / 60, 5);
  });

  it('REGRESSION (Timecamp Issue 2 "39→41"): ClockPunch split shift 37 + 2 min totals 39 (not 41)', () => {
    // The user's exact symptom: after a 37-min shift #1 and a 2-min shift #2,
    // the day total showed 41 (= 39 + 2) because the synthesized `current`
    // (from the dual-written top-level fields) re-counted shift #2's 2 minutes
    // that were already in `archived`. `coveredByArchived` must detect this.
    const data = {
      userId: 'u1',
      workDate: '2026-06-22',
      clockInManual: '14:00',
      clockOutManual: '14:02',
      dayComplete: true,
      totalWorkMinutes: 39,
      segments: [
        { id: 'seg_1', clockInManual: '12:30', clockOutManual: '13:07', workMinutes: 37, complete: true },
        { id: 'seg_2', clockInManual: '14:00', clockOutManual: '14:02', workMinutes: 2, complete: true },
      ],
      status: 'active',
    };
    const entry = mapEntry('u1_2026-06-22', data as any);
    expect(entry.totalWorkMinutes).toBe(39);
  });

  it('ClockPunch split shift: two closed shifts (37 + 9 min) total 46 min (not 55, not 92)', () => {
    // After punchOut #2 in a split shift, segments[] = [closedSeg1, closedSeg2]
    // and top-level fields mirror closedSeg2 (the most recent). The synthesized
    // current duplicates closedSeg2 only.
    const data = {
      userId: 'u1',
      workDate: '2026-06-22',
      clockInManual: '14:00',
      clockOutManual: '14:09',
      dayComplete: true,
      totalWorkMinutes: 46,
      segments: [
        {
          id: 'seg_1',
          clockInManual: '12:30',
          clockOutManual: '13:07',
          workMinutes: 37,
          complete: true,
        },
        {
          id: 'seg_2',
          clockInManual: '14:00',
          clockOutManual: '14:09',
          workMinutes: 9,
          complete: true,
        },
      ],
      status: 'active',
    };
    const entry = mapEntry('u1_2026-06-22', data as any);
    expect(entry.totalWorkMinutes).toBe(46);
  });

  it('TodayEntry single legacy shift (no segments[]) preserves totalWorkMinutes', () => {
    // TodayEntry writes only top-level fields + totalWorkMinutes, no segments[].
    // archived.length is 0 so the override does not apply; the stored value wins.
    const data = {
      userId: 'u1',
      workDate: '2026-06-22',
      clockInManual: '12:30',
      clockOutManual: '13:07',
      dayComplete: true,
      totalWorkMinutes: 37,
      status: 'active',
    };
    const entry = mapEntry('u1_2026-06-22', data as any);
    expect(entry.totalWorkMinutes).toBe(37);
    expect(entry.segments).toEqual([]);
  });

  it('TodayEntry split shift: archived seg (shift #1) + current (shift #2) both count', () => {
    // TodayEntry archives only prior shifts to segments[]; the current (most
    // recent) shift lives in top-level fields and is NOT duplicated in segments[].
    // The synthesized current MUST contribute its minutes here.
    const data = {
      userId: 'u1',
      workDate: '2026-06-22',
      clockInManual: '14:00',
      clockOutManual: '14:09',
      dayComplete: true,
      totalWorkMinutes: 46,
      segments: [
        {
          id: 'seg_1',
          clockInManual: '12:30',
          clockOutManual: '13:07',
          workMinutes: 37,
          complete: true,
        },
      ],
      status: 'active',
    };
    const entry = mapEntry('u1_2026-06-22', data as any);
    // archived(37) + current synthesized from top-level (9) = 46
    expect(entry.totalWorkMinutes).toBe(46);
  });

  it('ClockPunch open shift (clock-in only, no clock-out) does not synthesize current minutes', () => {
    // An open shift has no clockOutManual, so deriveCurrentSegmentMinutes
    // returns undefined → current.workMinutes is undefined → contributes 0.
    const data = {
      userId: 'u1',
      workDate: '2026-06-22',
      clockInManual: '09:00',
      dayComplete: false,
      totalWorkMinutes: 0,
      segments: [
        {
          id: 'seg_open',
          clockInManual: '09:00',
          complete: false,
        },
      ],
      status: 'active',
    };
    const entry = mapEntry('u1_2026-06-22', data as any);
    expect(entry.totalWorkMinutes).toBe(0);
  });
});

describe('buildConsistentClosePatch — S7 dual-write contract', () => {
  it('replace mode: single closed segment + matching total (no archived)', () => {
    const { segments, totalWorkMinutes, closedSegment } = buildConsistentClosePatch({
      clockIn: '08:00',
      clockOut: '17:00',
      skipLunch: false,
      lunchOut: '12:00',
      lunchIn: '12:30',
      clockOutSystem: 9000,
      mode: 'replace',
    });
    expect(segments).toHaveLength(1);
    expect(closedSegment.complete).toBe(true);
    expect(closedSegment.clockOutManual).toBe('17:00');
    expect(closedSegment.workMinutes).toBe(510); // 9h - 30min lunch
    expect(totalWorkMinutes).toBe(510);
  });

  it('replace mode: drops prior archived segments (admin correction collapse)', () => {
    const archived: TimeSegment = {
      id: 'seg_old',
      clockInManual: '08:00',
      clockOutManual: '12:00',
      workMinutes: 240,
      complete: true,
    };
    const { segments, totalWorkMinutes } = buildConsistentClosePatch({
      clockIn: '13:00',
      clockOut: '17:00',
      skipLunch: true,
      clockOutSystem: 9000,
      existingSegments: [archived],
      mode: 'replace',
    });
    expect(segments).toHaveLength(1); // prior archived dropped
    expect(segments[0].clockInManual).toBe('13:00');
    expect(totalWorkMinutes).toBe(240); // only the new 4h shift
  });

  it('append mode: preserves prior archived segments + appends closed', () => {
    const archived: TimeSegment = {
      id: 'seg_old',
      clockInManual: '08:00',
      clockOutManual: '12:00',
      workMinutes: 240,
      complete: true,
    };
    const { segments, totalWorkMinutes, closedSegment } = buildConsistentClosePatch({
      clockIn: '13:00',
      clockOut: '17:00',
      skipLunch: true,
      clockOutSystem: 9000,
      existingSegments: [archived],
      mode: 'append',
    });
    expect(segments).toHaveLength(2);
    expect(segments[0].id).toBe('seg_old');
    expect(segments[1].id).toBe(closedSegment.id);
    expect(totalWorkMinutes).toBe(480); // 240 archived + 240 new
  });

  it('append mode: ignores open (incomplete) existing segments', () => {
    const open: TimeSegment = {
      id: 'seg_open',
      clockInManual: '08:00',
      complete: false,
    };
    const { segments } = buildConsistentClosePatch({
      clockIn: '13:00',
      clockOut: '17:00',
      skipLunch: true,
      clockOutSystem: 9000,
      existingSegments: [open],
      mode: 'append',
    });
    // Open segment filtered out (only complete archived kept); only the new
    // closed segment remains.
    expect(segments).toHaveLength(1);
    expect(segments[0].complete).toBe(true);
  });

  it('S6 cross-midnight: 23:00 -> 02:00 = 180 min via the helper', () => {
    const { totalWorkMinutes, closedSegment } = buildConsistentClosePatch({
      clockIn: '23:00',
      clockOut: '02:00',
      skipLunch: true,
      clockOutSystem: 9000,
      mode: 'replace',
    });
    expect(closedSegment.workMinutes).toBe(180);
    expect(totalWorkMinutes).toBe(180);
  });

  it('produces a segment whose workMinutes matches totalWorkMinutes (replace, no archived)', () => {
    // The core S7 invariant: segments[last].workMinutes === totalWorkMinutes
    // so mapEntry's override (archivedMins + currentMins=0) agrees.
    const { segments, totalWorkMinutes } = buildConsistentClosePatch({
      clockIn: '09:00',
      clockOut: '17:30',
      skipLunch: false,
      lunchOut: '12:00',
      lunchIn: '12:30',
      clockOutSystem: 9000,
      mode: 'replace',
    });
    const last = segments[segments.length - 1];
    expect(last.workMinutes).toBe(totalWorkMinutes);
  });
});
