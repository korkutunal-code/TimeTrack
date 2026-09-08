/**
 * Regression test: Edit / Request Time Adjustments pending-badge scoping.
 *
 * Pre-fix, the active-request lookup was keyed by `${date}|${issueType}`, so
 * on a multi-shift day a correction request for Shift 1 rendered the yellow
 * badge on EVERY shift of that date (Shift 2 included). The fix keys requests
 * by `${date}|${issueType}|${shiftId}` (with a legacy date+issueType fallback
 * for requests that predate the `shift_id` field) so the badge attaches to
 * ONE shift only.
 */
import { buildActiveRequestMap, findActiveRequest } from './correctionBadge';

const DATE = '2026-09-05';
const CLOCK_IN = 'Clock In';

describe('correctionBadge — shift-scoped pending badge', () => {
  it('matches only the shift the request was submitted for (multi-shift day)', () => {
    const map = buildActiveRequestMap([
      { requested_date: DATE, issue_type: CLOCK_IN, shift_id: 'seg_shift1' },
    ]);

    // Shift 1 (the requested shift) shows the badge.
    expect(findActiveRequest(map, DATE, CLOCK_IN, 'seg_shift1')).toBeDefined();
    // Shift 2 on the SAME date + SAME field stays clean (the pre-fix bleed).
    expect(findActiveRequest(map, DATE, CLOCK_IN, 'seg_shift2')).toBeUndefined();
    // A different date entirely stays clean.
    expect(findActiveRequest(map, '2026-09-04', CLOCK_IN, 'seg_shift1')).toBeUndefined();
  });

  it('scopes badges per issue_type on the same shift', () => {
    const map = buildActiveRequestMap([
      { requested_date: DATE, issue_type: CLOCK_IN, shift_id: 'seg_shift1' },
    ]);
    // Clock Out request was NOT filed for this shift — no badge on that cell.
    expect(findActiveRequest(map, DATE, 'Clock Out', 'seg_shift1')).toBeUndefined();
  });

  it('falls back to date+issue_type matching for legacy requests without shift_id', () => {
    const map = buildActiveRequestMap([
      // Legacy request: no shift_id recorded.
      { requested_date: DATE, issue_type: CLOCK_IN, shift_id: undefined },
    ]);
    // Legacy behavior: badge surfaces on any shift of that date+field.
    expect(findActiveRequest(map, DATE, CLOCK_IN, 'seg_shift1')).toBeDefined();
    expect(findActiveRequest(map, DATE, CLOCK_IN, 'seg_shift2')).toBeDefined();
  });

  it('prefers the shift-scoped request over a legacy one for the same cell', () => {
    const legacy = { requested_date: DATE, issue_type: CLOCK_IN, shift_id: undefined };
    const scoped = { requested_date: DATE, issue_type: CLOCK_IN, shift_id: 'seg_shift1' };
    const map = buildActiveRequestMap([legacy, scoped]);
    expect(findActiveRequest(map, DATE, CLOCK_IN, 'seg_shift1')).toBe(scoped);
    // The other shift still falls back to the legacy request.
    expect(findActiveRequest(map, DATE, CLOCK_IN, 'seg_shift2')).toBe(legacy);
  });
});
