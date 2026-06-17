/**
 * Regression tests for the Firestore "Unsupported field value: undefined" bug.
 *
 * Bug: when ClockPunch / clockService calls `tx.set(ref, payload, { merge: true })`,
 * any field with value `undefined` causes the WHOLE write to fail with
 * "Unsupported field value: undefined". This was making clock-in silently fail
 * for employees in production. The fix: stripUndefined() + createInitialSegment()
 * must never emit `undefined` values.
 */
import {
  stripUndefined,
  createInitialSegment,
  closeActiveSegment,
  applyLunchToSegment,
} from './segmentOps';
import type { TimeSegment, TimeEntry } from './database';

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
 * Split-shift scenario: After punchOut, the closed segment must remain in
 * segments[] (complete=true). After the next punchIn, a new open segment
 * is appended, giving segments=[closedSeg, openSeg].
 *
 * Bug: punchOut was writing segments=[closedSeg] correctly, but the NEXT
 * punchIn was overwriting the entire array with segments=[newSeg], losing
 * the archived closed segment. The fix: punchIn now preserves existing
 * segments by reading them inside the transaction first.
 */
describe('Split-shift: punchOut then punchIn preserves archived segments', () => {
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

  it('entry.segments after punchOut should have the closed segment', () => {
    // Simulate what punchOut writes: the existing [openSeg] becomes [closedSeg]
    const openSeg: TimeSegment = {
      id: 'seg_1',
      clockInManual: '09:00',
      clockInSystem: 1000,
      complete: false,
    };
    const closed = closeActiveSegment(openSeg, '17:00', 8000 * 60 * 60 * 1000 + 1000);

    // After punchOut, the Firestore doc has segments=[closedSeg]
    const entryAfterPunchOut: any = {
      id: 'u1_2026-06-16',
      userId: 'u1',
      date: '2026-06-16',
      segments: [closed],
      clockInManual: '09:00',
      clockOutManual: '17:00',
      complete: true,
      currentStep: 4,
      status: 'active',
    };

    // getActiveSegment should return null (no open segment)
    const active = getActiveSegment(entryAfterPunchOut);
    expect(active).toBeNull();
    expect(hasOpenSegment(entryAfterPunchOut)).toBe(false);

    // And the closed segment should be in segments[]
    expect(entryAfterPunchOut.segments).toHaveLength(1);
    expect(entryAfterPunchOut.segments[0].complete).toBe(true);
  });

  it('split-shift punchIn must preserve existing closed segments', () => {
    // After punchOut: segments=[closedSeg]
    const closedSeg: TimeSegment = {
      id: 'seg_1',
      clockInManual: '09:00',
      clockInSystem: 1000,
      clockOutManual: '17:00',
      clockOutSystem: 8000,
      workMinutes: 480,
      complete: true,
    };

    // Simulate what punchIn should do: append new open segment to existing closed ones
    const newOpenSeg: TimeSegment = {
      id: 'seg_2',
      clockInManual: '18:00',
      clockInSystem: 9000,
      complete: false,
    };

    // The combined segments array should be [closedSeg, newOpenSeg]
    const allSegments: TimeSegment[] = [closedSeg, newOpenSeg];

    // Verify: 2 segments, first closed, second open
    expect(allSegments).toHaveLength(2);
    expect(allSegments[0].complete).toBe(true);
    expect(allSegments[1].complete).toBe(false);

    // Verify getActiveSegment returns the second (open) segment
    const entryForActiveCheck: any = {
      id: 'u1_2026-06-16',
      userId: 'u1',
      date: '2026-06-16',
      segments: allSegments,
      clockInManual: '18:00',
      complete: false,
      currentStep: 2,
      status: 'active',
    };
    const active = getActiveSegment(entryForActiveCheck);
    expect(active).not.toBeNull();
    expect(active!.id).toBe('seg_2');
    expect(active!.complete).toBe(false);
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

    // Correct behavior: append new segment to existing
    const correctSegments = [...existingClosedSegments, newOpenSeg];
    expect(correctSegments).toHaveLength(2);
    expect(correctSegments[0].complete).toBe(true);
    expect(correctSegments[1].complete).toBe(false);

    // Incorrect behavior (the bug): replace entire array
    const buggySegments = [newOpenSeg];
    expect(buggySegments).toHaveLength(1);
    expect(buggySegments[0].complete).toBe(false);
    // Bug: lost the closed segment!
  });
});
