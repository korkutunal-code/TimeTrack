/**
 * Regression tests for the time-validation module.
 *
 * Coverage targets:
 *  - timeToMinutes (already in timeCalculations.test.ts; we re-pin the contract)
 *  - validateClockIn / validateLunchOut / validateLunchIn / validateClockOut
 *  - validateTimeSequence — full chain
 *  - getMinTimeForStep — input min bound
 *  - formatTimeWithAMPM
 *  - checkTimeAnomalies — weekend, early, late, short interval, >12h shift
 */
import {
    timeToMinutes,
    isTimeAfter,
    validateClockIn,
    validateLunchOut,
    validateLunchIn,
    validateClockOut,
    validateTimeSequence,
    getMinTimeForStep,
    formatTimeWithAMPM,
    checkTimeAnomalies,
    validateCanPunchIn,
    validateCanPunchOut,
    validateCanToggleLunch,
} from './timeValidation';

describe('timeValidation.timeToMinutes', () => {
    it('parses HH:MM to minutes', () => {
        expect(timeToMinutes('00:00')).toBe(0);
        expect(timeToMinutes('08:30')).toBe(510);
        expect(timeToMinutes('23:59')).toBe(1439);
    });

    it('returns 0 for null/undefined/empty (defensive — called from checkTimeAnomalies)', () => {
        expect(timeToMinutes(null as any)).toBe(0);
        expect(timeToMinutes(undefined as any)).toBe(0);
        expect(timeToMinutes('')).toBe(0);
    });
});

describe('timeValidation.isTimeAfter', () => {
    it('returns true iff t2 > t1', () => {
        expect(isTimeAfter('08:00', '09:00')).toBe(true);
        expect(isTimeAfter('08:00', '08:00')).toBe(false);
        expect(isTimeAfter('09:00', '08:00')).toBe(false);
    });
});

describe('timeValidation.validateClockIn', () => {
    it('rejects empty', () => {
        expect(validateClockIn('').valid).toBe(false);
    });
    it('accepts any non-empty HH:MM string', () => {
        expect(validateClockIn('07:00').valid).toBe(true);
        expect(validateClockIn('23:30').valid).toBe(true);
    });
});

describe('timeValidation.validateLunchOut', () => {
    it('requires a value', () => {
        expect(validateLunchOut('', '08:00').valid).toBe(false);
    });
    it('requires a clock-in to compare against', () => {
        expect(validateLunchOut('12:00', '').valid).toBe(false);
    });
    it('flags lunch_out at or before clock_in', () => {
        expect(validateLunchOut('08:00', '08:00').valid).toBe(false);
        expect(validateLunchOut('07:30', '08:00').valid).toBe(false);
    });
    it('accepts lunch_out after clock_in', () => {
        expect(validateLunchOut('12:00', '08:00').valid).toBe(true);
    });
});

describe('timeValidation.validateLunchIn', () => {
    it('requires both fields', () => {
        expect(validateLunchIn('', '12:00').valid).toBe(false);
        expect(validateLunchIn('12:30', '').valid).toBe(false);
    });
    it('flags lunch_in at or before lunch_out', () => {
        expect(validateLunchIn('12:00', '12:00').valid).toBe(false);
        expect(validateLunchIn('11:30', '12:00').valid).toBe(false);
    });
    it('accepts lunch_in after lunch_out', () => {
        expect(validateLunchIn('12:30', '12:00').valid).toBe(true);
    });
});

describe('timeValidation.validateClockOut', () => {
    it('requires clock_out and clock_in', () => {
        expect(validateClockOut('', '08:00').valid).toBe(false);
        expect(validateClockOut('17:00', '').valid).toBe(false);
    });
    it('flags clock_out at or before clock_in', () => {
        expect(validateClockOut('08:00', '08:00').valid).toBe(false);
        expect(validateClockOut('07:30', '08:00').valid).toBe(false);
    });
    it('flags clock_out at or before lunch_in when lunch was taken', () => {
        expect(validateClockOut('12:30', '08:00', '12:30').valid).toBe(false);
        expect(validateClockOut('12:00', '08:00', '12:30').valid).toBe(false);
    });
    it('accepts clock_out after lunch_in (lunch taken)', () => {
        expect(validateClockOut('17:00', '08:00', '12:30').valid).toBe(true);
    });
    it('accepts clock_out after clock_in when no lunch', () => {
        expect(validateClockOut('17:00', '08:00', null).valid).toBe(true);
    });
});

describe('timeValidation.validateTimeSequence', () => {
    it('accepts a full valid sequence', () => {
        const r = validateTimeSequence({
            clockInManual: '08:00',
            lunchOutManual: '12:00',
            lunchInManual: '12:30',
            clockOutManual: '17:00',
        });
        expect(r.valid).toBe(true);
        expect(r.errors).toEqual([]);
    });

    it('flags missing clock_in', () => {
        const r = validateTimeSequence({
            clockInManual: '',
            lunchOutManual: '12:00',
            lunchInManual: '12:30',
            clockOutManual: '17:00',
        });
        expect(r.valid).toBe(false);
        expect(r.errors).toContain('Clock in is required');
    });

    it('flags lunch_in without lunch_out and vice-versa', () => {
        expect(
            validateTimeSequence({
                clockInManual: '08:00',
                lunchOutManual: '12:00',
                lunchInManual: '',
                clockOutManual: '17:00',
            }).errors,
        ).toContain('Lunch in is required if lunch out is entered');
        expect(
            validateTimeSequence({
                clockInManual: '08:00',
                lunchOutManual: '',
                lunchInManual: '12:30',
                clockOutManual: '17:00',
            }).errors,
        ).toContain('Lunch out is required if lunch in is entered');
    });

    it('flags every out-of-order step', () => {
        const r = validateTimeSequence({
            clockInManual: '08:00',
            lunchOutManual: '07:30', // before clock-in
            lunchInManual: '07:00',   // before lunch-out
            clockOutManual: '07:00',  // before lunch-in
        });
        expect(r.errors).toEqual(
            expect.arrayContaining([
                'Lunch out must be after clock in',
                'Lunch in must be after lunch out',
                'Clock out must be after clock in',
                'Clock out must be after lunch in',
            ]),
        );
    });
});

describe('timeValidation.getMinTimeForStep', () => {
    it('returns the prior step as the min bound', () => {
        expect(getMinTimeForStep('lunchOut', { clockIn: '08:00' })).toBe('08:00');
        expect(getMinTimeForStep('lunchIn', { clockIn: '08:00', lunchOut: '12:00' })).toBe('12:00');
        expect(getMinTimeForStep('clockOut', { clockIn: '08:00', lunchOut: '12:00', lunchIn: '12:30' })).toBe('12:30');
    });

    it('falls back to clockIn for clockOut when no lunch', () => {
        expect(getMinTimeForStep('clockOut', { clockIn: '08:00' })).toBe('08:00');
    });

    it('returns null when no prior step', () => {
        expect(getMinTimeForStep('lunchOut', {})).toBeNull();
        expect(getMinTimeForStep('clockOut', {})).toBeNull();
    });
});

describe('timeValidation.formatTimeWithAMPM', () => {
    it('formats 24h to 12h AM/PM', () => {
        expect(formatTimeWithAMPM('00:00')).toBe('12:00 AM');
        expect(formatTimeWithAMPM('08:05')).toBe('8:05 AM');
        expect(formatTimeWithAMPM('12:00')).toBe('12:00 PM');
        expect(formatTimeWithAMPM('13:30')).toBe('1:30 PM');
        expect(formatTimeWithAMPM('23:59')).toBe('11:59 PM');
    });
    it('handles empty gracefully', () => {
        expect(formatTimeWithAMPM('')).toBe('');
    });
});

describe('timeValidation.checkTimeAnomalies', () => {
    it('returns no anomaly for "complete" step or empty time', () => {
        expect(checkTimeAnomalies('complete', '', '2025-01-15', {}).hasAnomaly).toBe(false);
        expect(checkTimeAnomalies(0, '', '2025-01-15', {}).hasAnomaly).toBe(false);
    });

    it('flags weekend entries', () => {
        // 2025-01-04 is a Saturday
        const r = checkTimeAnomalies(0, '09:00', '2025-01-04', {});
        expect(r.hasAnomaly).toBe(true);
    });

    it('flags clock-in before 6am', () => {
        const r = checkTimeAnomalies(0, '05:30', '2025-01-15', {}); // Wednesday
        expect(r.hasAnomaly).toBe(true);
    });

    it('flags clock-out after 6pm', () => {
        const r = checkTimeAnomalies(3, '19:00', '2025-01-15', { clockInManual: '08:00' });
        expect(r.hasAnomaly).toBe(true);
    });

    it('flags shift >12h', () => {
        const r = checkTimeAnomalies(3, '21:00', '2025-01-15', { clockInManual: '08:00' });
        expect(r.hasAnomaly).toBe(true);
        // Either the long-shift message or the standard "unusual" message is acceptable
        expect(r.message).toBeTruthy();
    });

    it('does not flag a normal 9-hour shift', () => {
        const r = checkTimeAnomalies(3, '17:00', '2025-01-15', { clockInManual: '08:00' });
        expect(r.hasAnomaly).toBe(false);
    });
});

/**
 * Regression tests for the legacy-clockIn half-baked doc shape.
 *
 * Bug found 2026-06-15: legacy TodayEntry form writes legacy top-level fields
 * (`clockInManual`, etc.) but no `segments[]` and no `clockInSystem` (millis).
 * If a user clocked in via that form, then re-loaded the page, the new
 * ClockPunch UI would show "CLOCKED OUT" and the punchIn transaction would
 * also pass the "no open segment" check — letting them clock in twice for
 * the same day.
 *
 * Fix: `hasOpenSegmentLocal` and the `validateCanPunchIn/Out/ToggleLunch`
 * functions fall back to the legacy top-level fields.
 */
describe('validateCanPunchIn — legacy fallback', () => {
    it('allows clock-in for an empty entry', () => {
        expect(validateCanPunchIn(null).valid).toBe(true);
        expect(validateCanPunchIn(undefined as any).valid).toBe(true);
        expect(validateCanPunchIn({ id: 'u1_d', userId: 'u1', date: 'd', complete: false, currentStep: 0 } as any).valid).toBe(true);
    });

    it('rejects clock-in when segments[] has an open segment', () => {
        const entry = {
            id: 'u1_2026-06-15',
            userId: 'u1',
            date: '2026-06-15',
            segments: [{ id: 's1', clockInManual: '08:00', complete: false }],
            complete: false,
            currentStep: 2,
        } as any;
        const r = validateCanPunchIn(entry);
        expect(r.valid).toBe(false);
        expect(r.message).toMatch(/open shift/i);
    });

    it('rejects clock-in when currentSegment is open (synthesized view)', () => {
        const entry = {
            id: 'u1_2026-06-15',
            userId: 'u1',
            date: '2026-06-15',
            segments: [],
            currentSegment: { id: 'u1_2026-06-15_current', clockInManual: '08:00', complete: false },
            complete: false,
            currentStep: 2,
        } as any;
        const r = validateCanPunchIn(entry);
        expect(r.valid).toBe(false);
    });

    it('REGRESSION (the TodayEntry bug): rejects clock-in for legacy half-baked open-shift doc', () => {
        const entry = {
            id: 'u1_2026-06-15',
            userId: 'u1',
            date: '2026-06-15',
            // No segments, no currentSegment — only legacy top-level fields
            clockInManual: '08:30',
            clockInSystem: 1700000000000,
            complete: false,
            currentStep: 2,
        } as any;
        const r = validateCanPunchIn(entry);
        expect(r.valid).toBe(false);
        expect(r.message).toMatch(/open shift/i);
    });

    it('allows clock-in for a closed legacy doc (clockIn AND clockOut set)', () => {
        const entry = {
            id: 'u1_2026-06-15',
            userId: 'u1',
            date: '2026-06-15',
            clockInManual: '08:30',
            clockOutManual: '17:00',
            complete: true,
            currentStep: 4,
        } as any;
        expect(validateCanPunchIn(entry).valid).toBe(true);
    });
});

describe('validateCanPunchOut — legacy fallback', () => {
    it('REGRESSION (the TodayEntry bug): allows clock-out for legacy half-baked open-shift doc', () => {
        const entry = {
            id: 'u1_2026-06-15',
            userId: 'u1',
            date: '2026-06-15',
            clockInManual: '08:30',
            complete: false,
            currentStep: 2,
        } as any;
        const r = validateCanPunchOut(entry);
        expect(r.valid).toBe(true);
    });

    it('rejects clock-out for a closed entry', () => {
        const entry = {
            id: 'u1_2026-06-15',
            userId: 'u1',
            date: '2026-06-15',
            clockInManual: '08:30',
            clockOutManual: '17:00',
            complete: true,
            currentStep: 4,
        } as any;
        expect(validateCanPunchOut(entry).valid).toBe(false);
    });
});

describe('validateCanToggleLunch — legacy fallback', () => {
    it('REGRESSION (the TodayEntry bug): allows lunch toggle for legacy half-baked open-shift doc', () => {
        const entry = {
            id: 'u1_2026-06-15',
            userId: 'u1',
            date: '2026-06-15',
            clockInManual: '08:30',
            complete: false,
            currentStep: 2,
        } as any;
        const r = validateCanToggleLunch(entry);
        expect(r.valid).toBe(true);
    });
});

describe('voided/archived entries are never "open"', () => {
    it('validateCanPunchIn allows clock-in for a voided entry even with open segment in segments[]', () => {
        // Real-world: cleanup script soft-voids a doc but doesn't rewrite
        // segments[]. The validator must still treat this as "no open shift".
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
        expect(validateCanPunchIn(entry).valid).toBe(true);
    });

    it('validateCanPunchOut rejects (no open shift to close) for a voided entry', () => {
        const openSeg = { id: 'seg_1', clockInManual: '08:30', clockInSystem: 1, complete: false };
        const entry = {
            id: 'u1_2026-06-15',
            userId: 'u1',
            date: '2026-06-15',
            segments: [openSeg],
            complete: false,
            currentStep: 2,
            status: 'voided',
        } as any;
        expect(validateCanPunchOut(entry).valid).toBe(false);
    });

    it('validateCanToggleLunch rejects for an archived entry', () => {
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
        expect(validateCanToggleLunch(entry).valid).toBe(false);
    });
});
