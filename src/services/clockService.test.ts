/**
 * S5 regression tests for findOpenShiftEntry.
 *
 * Covers the cross-midnight scenario: an employee clocks in at 23:00 PT on
 * day N, and after midnight PT (day N+1) the open segment still lives on the
 * day-N doc. findOpenShiftEntry must locate it by scanning recent days so
 * punchOut / getPunchStatus / toggleLunch keep working across midnight.
 *
 * dbService is mocked (firebase-free); getActiveSegment uses the real pure
 * implementation from segmentOps.
 */
jest.mock('../app/lib/firebase', () => ({ db: {} }));

const getTimeEntry = jest.fn();
const getTimeEntriesForUserInRange = jest.fn();

jest.mock('../app/lib/database', () => {
  const actual = jest.requireActual('../app/lib/database');
  return {
    ...actual,
    dbService: {
      getTimeEntry,
      getTimeEntriesForUserInRange,
    },
  };
});

import { findOpenShiftEntry } from './clockService';
import type { TimeEntry } from '../app/lib/database';

function makeEntry(userId: string, date: string, open: boolean): TimeEntry {
  return {
    id: `${userId}_${date}`,
    userId,
    date,
    clockInManual: open ? '23:00' : '08:00',
    clockOutManual: open ? undefined : '17:00',
    complete: !open,
    currentStep: open ? 2 : 4,
    status: 'active',
    segments: [
      {
        id: `seg_${date}`,
        clockInManual: open ? '23:00' : '08:00',
        clockOutManual: open ? undefined : '17:00',
        complete: !open,
      } as any,
    ],
  } as any;
}

const UID = 'bTSuNL1pNZVtAS724rwlMGW4qJm1';

describe('findOpenShiftEntry — S5 cross-midnight', () => {
  beforeEach(() => {
    getTimeEntry.mockReset();
    getTimeEntriesForUserInRange.mockReset();
  });

  it('fast-path returns today’s entry when it has an open segment', async () => {
    const today = '2026-07-17';
    const open = makeEntry(UID, today, true);
    getTimeEntry.mockResolvedValue(open);

    const result = await findOpenShiftEntry(UID);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(open.id);
    expect(getTimeEntry).toHaveBeenCalledTimes(1);
    // Fallback query must NOT run when today’s doc already has the open shift.
    expect(getTimeEntriesForUserInRange).not.toHaveBeenCalled();
  });

  it('falls back to a prior-day doc when today has no open segment (cross-midnight)', async () => {
    const today = '2026-07-17';
    const yesterday = '2026-07-16';
    // Today’s doc: complete, no open segment.
    getTimeEntry.mockResolvedValue(makeEntry(UID, today, false));
    // Range query returns yesterday’s open shift first (workDate desc).
    getTimeEntriesForUserInRange.mockResolvedValue([
      makeEntry(UID, yesterday, true), // open cross-midnight shift
      makeEntry(UID, '2026-07-15', false),
    ]);

    const result = await findOpenShiftEntry(UID);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(`${UID}_${yesterday}`);
    expect(result?.date).toBe(yesterday);
    // Range query covers the last 3 PT days ending today.
    const [uid, start, end] = getTimeEntriesForUserInRange.mock.calls[0];
    expect(uid).toBe(UID);
    expect(end).toBe(today);
    expect(start).toBe('2026-07-14'); // today - 3 days
  });

  it('returns null when no open shift exists on any recent day', async () => {
    getTimeEntry.mockResolvedValue(makeEntry(UID, '2026-07-17', false));
    getTimeEntriesForUserInRange.mockResolvedValue([
      makeEntry(UID, '2026-07-16', false),
      makeEntry(UID, '2026-07-15', false),
    ]);

    const result = await findOpenShiftEntry(UID);
    expect(result).toBeNull();
  });

  it('skips voided/archived docs when scanning for an open shift', async () => {
    // Today: none. Range returns a voided doc with a nominally-open segment,
    // which getActiveSegment must ignore, plus a real open shift.
    getTimeEntry.mockResolvedValue(null);
    const voided = makeEntry(UID, '2026-07-16', true);
    voided.status = 'voided';
    const active = makeEntry(UID, '2026-07-15', true);
    getTimeEntriesForUserInRange.mockResolvedValue([voided, active]);

    const result = await findOpenShiftEntry(UID);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(active.id);
  });
});
