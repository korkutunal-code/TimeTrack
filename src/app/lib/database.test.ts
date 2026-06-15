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
