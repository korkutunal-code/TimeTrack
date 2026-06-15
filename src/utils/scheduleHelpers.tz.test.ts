/**
 * Regression tests for scheduleHelpers TZ fix + database pagination behaviour.
 *
 * TZ fix: `checkWrongDay` used to use `new Date(workDate).getDay()` which
 * parsed in runtime local TZ. Pin UTC-anchored behaviour.
 *
 * Pagination: `getAllTimeEntries` previously hard-capped at 500 — silent
 * payroll truncation. New behaviour: iterate pages. The Firebase client is
 * not loaded in node tests, so we exercise only the unit-level TZ logic
 * here. The pagination change is covered by an integration test in the
 * emulator suite (out of scope for this file).
 */
import { checkWrongDay, SCHEDULE_TYPES, RED_FLAGS } from './scheduleHelpers';

const ft = {
    type: SCHEDULE_TYPES.FULL_TIME,
    startTime: '08:00',
    endTime: '17:00',
    workDays: [1, 2, 3, 4, 5], // Mon-Fri
};

describe('scheduleHelpers.checkWrongDay — TZ safety', () => {
    it('flags Saturday in UTC', () => {
        // 2025-01-04 is Saturday
        const r = checkWrongDay('2025-01-04', ft);
        expect(r?.type).toBe(RED_FLAGS.WRONG_DAY);
    });

    it('flags Sunday in UTC', () => {
        // 2025-01-05 is Sunday
        const r = checkWrongDay('2025-01-05', ft);
        expect(r?.type).toBe(RED_FLAGS.WRONG_DAY);
    });

    it('passes a Wednesday in UTC', () => {
        // 2025-01-08 is Wednesday
        expect(checkWrongDay('2025-01-08', ft)).toBeNull();
    });

    it('passes a Monday workDate in UTC even on a UTC server (the bug case)', () => {
        // Previously: on a UTC server, `new Date('2025-01-06').getDay()` returned
        // 0 (Sunday) because '2025-01-06' was parsed as 2025-01-06 00:00 UTC
        // = 2025-01-05 16:00 PT. So a Monday for a PT user was flagged as
        // wrong day. Now UTC-anchored parsing fixes this.
        // 2025-01-06 is Monday in any TZ.
        expect(checkWrongDay('2025-01-06', ft)).toBeNull();
    });

    it('returns null for malformed input instead of throwing', () => {
        expect(() => checkWrongDay('garbage', ft)).not.toThrow();
        expect(checkWrongDay('garbage', ft)).toBeNull();
    });

    it('returns null for freelancers regardless of date', () => {
        expect(checkWrongDay('2025-01-04', { ...ft, type: SCHEDULE_TYPES.FREELANCE })).toBeNull();
    });
});
