/**
 * SSOT segment-minutes + write-side recalculation tests.
 *
 * computeSegmentWorkMinutes is the single canonical segment-minutes function
 * used by every write path (direct edits, closes) and read path (mapEntry,
 * Payroll rebuild). It is a HYBRID: stored workMinutes when it agrees with the
 * manual punch signal (preserves split-boundary accuracy), else the manual
 * punch times (so an edit — which updates only the *Manual strings —
 * propagates), else the system-timestamp span (manual absent).
 */
import {
  computeSegmentWorkMinutes,
  recalculateEntryTotals,
  recomputeSegmentSystemTimestamps,
  fieldToSystemField,
} from './segmentOps';
import type { TimeSegment } from './database';
import { hhmmInZone } from '../../utils/timeView';

describe('computeSegmentWorkMinutes — hybrid SSOT', () => {
  it('returns stored workMinutes when it agrees with the manual signal (non-edited)', () => {
    const seg: TimeSegment = {
      id: 's1', clockInManual: '09:00', clockOutManual: '17:00',
      workMinutes: 480, complete: true,
    };
    expect(computeSegmentWorkMinutes(seg)).toBe(480);
  });

  it('returns the MANUAL minutes when stored has diverged (edited shift)', () => {
    // clockOut edited 17:00 -> 18:00, but stored workMinutes (480) is stale.
    const seg: TimeSegment = {
      id: 's1', clockInManual: '09:00', clockOutManual: '18:00',
      workMinutes: 480, complete: true,
    };
    expect(computeSegmentWorkMinutes(seg)).toBe(540); // 9h, the EDITED total
  });

  it('keeps the accurate split value within the 1-min tolerance (no artifact)', () => {
    // A 23:59:59 close stored as '23:59' (27 manual) with stored 28 (system).
    // The hybrid must keep 28 (accurate), not regress to 27.
    const seg: TimeSegment = {
      id: 'd1', clockInManual: '23:32', clockOutManual: '23:59',
      workMinutes: 28, complete: true, splitFromMidnight: true,
    };
    expect(computeSegmentWorkMinutes(seg)).toBe(28);
  });

  it('handles a cross-midnight manual span (23:00 -> 02:00 = 3h)', () => {
    const seg: TimeSegment = {
      id: 's1', clockInManual: '23:00', clockOutManual: '02:00', complete: true,
    };
    expect(computeSegmentWorkMinutes(seg)).toBe(180);
  });

  it('subtracts a manual lunch', () => {
    const seg: TimeSegment = {
      id: 's1', clockInManual: '09:00', clockOutManual: '17:00',
      lunchOutManual: '12:00', lunchInManual: '12:30', complete: true,
    };
    expect(computeSegmentWorkMinutes(seg)).toBe(450); // 8h - 30m lunch
  });

  it('falls back to the system-timestamp span when manual punch times are absent', () => {
    const inSys = Date.UTC(2026, 6, 30, 9, 0, 0);
    const outSys = Date.UTC(2026, 6, 30, 17, 0, 0);
    const seg: TimeSegment = {
      id: 's1', clockInSystem: inSys, clockOutSystem: outSys, complete: true,
    };
    expect(computeSegmentWorkMinutes(seg)).toBe(480);
  });

  it('respects skipLunch (no deduction)', () => {
    const seg: TimeSegment = {
      id: 's1', clockInManual: '09:00', clockOutManual: '17:00',
      lunchOutManual: '12:00', lunchInManual: '12:30', skipLunch: true, complete: true,
    };
    expect(computeSegmentWorkMinutes(seg)).toBe(480);
  });
});

describe('recalculateEntryTotals — write-side SSOT', () => {
  it('recomputes the edited segment workMinutes + day total + totalHours', () => {
    // One segment, clockOut edited to 18:00, stale stored workMinutes 480.
    const segs: TimeSegment[] = [
      { id: 's1', clockInManual: '09:00', clockOutManual: '18:00', workMinutes: 480, complete: true },
    ];
    const out = recalculateEntryTotals(segs);
    expect(out.segments[0].workMinutes).toBe(540); // recomputed from manual
    expect(out.totalWorkMinutes).toBe(540);
    expect(out.totalHours).toBeCloseTo(9, 5);
  });

  it('sums multiple segments and recomputes only the divergent one', () => {
    const segs: TimeSegment[] = [
      { id: 's1', clockInManual: '08:00', clockOutManual: '12:00', workMinutes: 240, complete: true }, // consistent
      { id: 's2', clockInManual: '13:00', clockOutManual: '18:00', workMinutes: 300, complete: true }, // edited (was 17:00=240, now 18:00=300) — stored 300 already matches manual here
    ];
    const out = recalculateEntryTotals(segs);
    expect(out.totalWorkMinutes).toBe(540); // 240 + 300
  });

  it('leaves open segments (no clock-out) untouched', () => {
    const segs: TimeSegment[] = [
      { id: 'open', clockInManual: '09:00', complete: false },
      { id: 's1', clockInManual: '08:00', clockOutManual: '12:00', workMinutes: 240, complete: true },
    ];
    const out = recalculateEntryTotals(segs);
    expect(out.segments[0].complete).toBe(false);
    expect(out.totalWorkMinutes).toBe(240); // only the closed segment
  });
});

describe('fieldToSystemField', () => {
  it('maps each manual field to its system counterpart', () => {
    expect(fieldToSystemField('clockInManual')).toBe('clockInSystem');
    expect(fieldToSystemField('clockOutManual')).toBe('clockOutSystem');
    expect(fieldToSystemField('lunchOutManual')).toBe('lunchOutSystem');
    expect(fieldToSystemField('lunchInManual')).toBe('lunchInSystem');
  });
});

describe('recomputeSegmentSystemTimestamps — edit *System sync (SSOT)', () => {
  // Reproduces the reported bug: a manual edit updates *Manual but leaves
  // *System stale, so displays that prefer *System show the pre-edit time.
  // After recompute, *System must reflect the EDITED manual value.
  it('recomputes all *System fields from *Manual so the display shows the edited time', () => {
    const tz = 'America/Los_Angeles';
    // Original punch: 09:00–17:00 PDT on 2026-07-30 (stale system instants).
    const staleIn = Date.UTC(2026, 6, 30, 16, 0, 0); // 09:00 PDT
    const staleOut = Date.UTC(2026, 6, 31, 0, 0, 0); // 17:00 PDT
    // Employee edits clockOut 17:00 -> 18:00 (manual updated, system still stale).
    const seg: TimeSegment = {
      id: 's1',
      clockInManual: '09:00', clockOutManual: '18:00',
      clockInSystem: staleIn, clockOutSystem: staleOut,
      complete: true,
    };
    const out = recomputeSegmentSystemTimestamps(seg, '2026-07-30', tz);
    // clockOutSystem must now be 18:00 PDT = 01:00 UTC 07-31 (the EDITED time).
    expect(out.clockOutSystem).toBe(Date.UTC(2026, 6, 31, 1, 0, 0));
    expect(hhmmInZone(out.clockOutSystem!, tz)).toBe('18:00');
    // clockInSystem recomputed to match its manual (09:00 PDT), not stale.
    expect(hhmmInZone(out.clockInSystem!, tz)).toBe('09:00');
  });

  it('handles cross-midnight: clockOut earlier than clockIn lands on the next day', () => {
    const tz = 'America/Los_Angeles';
    const seg: TimeSegment = {
      id: 's1', clockInManual: '23:00', clockOutManual: '02:00', complete: true,
    };
    const out = recomputeSegmentSystemTimestamps(seg, '2026-07-30', tz);
    expect(hhmmInZone(out.clockInSystem!, tz)).toBe('23:00');
    // 02:00 on 07-31 PDT (next day)
    expect(hhmmInZone(out.clockOutSystem!, tz)).toBe('02:00');
    expect(out.clockOutSystem!).toBeGreaterThan(out.clockInSystem!);
  });

  it('recomputes lunch boundaries wrap-aware from clockIn', () => {
    const tz = 'America/Los_Angeles';
    const seg: TimeSegment = {
      id: 's1',
      clockInManual: '23:00', clockOutManual: '07:00',
      lunchOutManual: '23:30', lunchInManual: '00:15',
      complete: true,
    };
    const out = recomputeSegmentSystemTimestamps(seg, '2026-07-30', tz);
    expect(hhmmInZone(out.lunchOutSystem!, tz)).toBe('23:30');
    expect(hhmmInZone(out.lunchInSystem!, tz)).toBe('00:15');
    expect(out.lunchInSystem!).toBeGreaterThan(out.lunchOutSystem!);
  });

  it('only sets *System for fields that have a *Manual value', () => {
    const seg: TimeSegment = {
      id: 's1', clockInManual: '09:00', clockOutManual: '17:00', complete: true,
    };
    const out = recomputeSegmentSystemTimestamps(seg, '2026-07-30', 'America/Los_Angeles');
    expect(typeof out.clockInSystem).toBe('number');
    expect(typeof out.clockOutSystem).toBe('number');
    expect(out.lunchOutSystem).toBeUndefined();
    expect(out.lunchInSystem).toBeUndefined();
  });

  it('returns the segment unchanged when timezone or anchorDate is absent', () => {
    const seg: TimeSegment = { id: 's1', clockInManual: '09:00', clockOutManual: '17:00', complete: true };
    expect(recomputeSegmentSystemTimestamps(seg, undefined, 'UTC')).toBe(seg);
    expect(recomputeSegmentSystemTimestamps(seg, '2026-07-30', undefined)).toBe(seg);
  });
});
