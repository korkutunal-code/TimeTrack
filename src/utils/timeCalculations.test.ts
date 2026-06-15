import {
    timeToMinutes,
    minutesToTime,
    calculateLunchMinutes,
    calculateTotalWorkMinutes,
    formatMinutesToHoursMinutes,
    minutesToDecimalHours,
    formatHoursHMM,
    validateTimeEntry,
    checkLunchWarnings,
    getWarningMessage,
} from './timeCalculations';

describe('timeCalculations', () => {
    describe('timeToMinutes', () => {
        it('converts a basic HH:MM string to minutes', () => {
            expect(timeToMinutes('08:30')).toBe(8 * 60 + 30);
            expect(timeToMinutes('00:00')).toBe(0);
            expect(timeToMinutes('23:59')).toBe(23 * 60 + 59);
        });

        it.each([
            ['undefined', undefined, 0],
            ['null', null, 0],
            ['empty string', '', 0],
            ['whitespace-only', '   ', 0],
        ])('returns 0 for %s', (_label, input, expected) => {
            expect(timeToMinutes(input as any)).toBe(expected);
        });
    });

    describe('minutesToTime', () => {
        it('formats minutes back to zero-padded HH:MM', () => {
            expect(minutesToTime(0)).toBe('00:00');
            expect(minutesToTime(65)).toBe('01:05');
            expect(minutesToTime(8 * 60 + 30)).toBe('08:30');
            expect(minutesToTime(23 * 60 + 59)).toBe('23:59');
        });

        it('is the inverse of timeToMinutes', () => {
            for (const t of ['00:00', '07:15', '12:00', '18:45', '23:59']) {
                expect(minutesToTime(timeToMinutes(t))).toBe(t);
            }
        });
    });

    describe('calculateLunchMinutes', () => {
        it('returns the delta between lunchOut and lunchIn', () => {
            expect(calculateLunchMinutes('12:00', '12:30')).toBe(30);
            expect(calculateLunchMinutes('12:00', '13:00')).toBe(60);
        });

        it('returns 0 when either endpoint is missing', () => {
            expect(calculateLunchMinutes('', '13:00')).toBe(0);
            expect(calculateLunchMinutes('12:00', '')).toBe(0);
            expect(calculateLunchMinutes('', '')).toBe(0);
        });
    });

    describe('calculateTotalWorkMinutes', () => {
        it('subtracts lunch from the shift length', () => {
            // 09:00 -> 17:00 = 480 min, minus 30 lunch = 450
            expect(calculateTotalWorkMinutes('09:00', '17:00', 30)).toBe(450);
        });

        it('returns 0 when clock in/out missing', () => {
            expect(calculateTotalWorkMinutes('', '17:00', 30)).toBe(0);
            expect(calculateTotalWorkMinutes('09:00', '', 30)).toBe(0);
        });

        it('supports a zero-lunch workday', () => {
            expect(calculateTotalWorkMinutes('08:00', '12:00', 0)).toBe(240);
        });
    });

    describe('formatMinutesToHoursMinutes', () => {
        it('formats combined hours and minutes', () => {
            expect(formatMinutesToHoursMinutes(0)).toBe('0h 0m');
            expect(formatMinutesToHoursMinutes(59)).toBe('0h 59m');
            expect(formatMinutesToHoursMinutes(60)).toBe('1h 0m');
            expect(formatMinutesToHoursMinutes(8 * 60 + 15)).toBe('8h 15m');
        });
    });

    describe('minutesToDecimalHours', () => {
        it('returns 2-decimal decimal hours', () => {
            expect(minutesToDecimalHours(0)).toBe('0.00');
            expect(minutesToDecimalHours(30)).toBe('0.50');
            expect(minutesToDecimalHours(450)).toBe('7.50');
        });
    });

    describe('formatHoursHMM', () => {
        it('formats decimal hours to H:MM', () => {
            expect(formatHoursHMM(2.5)).toBe('2:30');
            expect(formatHoursHMM(0)).toBe('0:00');
            expect(formatHoursHMM(12.75)).toBe('12:45');
        });

        it('rounds to nearest minute', () => {
            // 2.63h = 157.8 min -> rounds to 158 min = 2:38
            expect(formatHoursHMM(2.63)).toBe('2:38');
        });

        it('clamps negative values to 0:00', () => {
            expect(formatHoursHMM(-5)).toBe('0:00');
        });

        it.each([
            ['null', null],
            ['undefined', undefined],
            ['NaN', Number.NaN],
        ])('returns 0:00 for %s', (_label, input) => {
            expect(formatHoursHMM(input as any)).toBe('0:00');
        });
    });

    describe('validateTimeEntry', () => {
        const good = {
            clockInManual: '09:00',
            clockOutManual: '17:00',
            lunchOutManual: '12:00',
            lunchInManual: '12:30',
        };

        it('accepts a well-formed entry with lunch', () => {
            expect(validateTimeEntry(good)).toEqual([]);
        });

        it('accepts a well-formed entry without lunch', () => {
            expect(
                validateTimeEntry({
                    clockInManual: '09:00',
                    clockOutManual: '17:00',
                    lunchOutManual: '',
                    lunchInManual: '',
                }),
            ).toEqual([]);
        });

        it('flags clock-out before clock-in', () => {
            expect(
                validateTimeEntry({ ...good, clockOutManual: '08:00' }),
            ).toContain('Clock out must be after clock in');
        });

        it('requires both lunch fields together', () => {
            expect(
                validateTimeEntry({ ...good, lunchInManual: '' }),
            ).toContain('Both lunch times required or leave both empty');
            expect(
                validateTimeEntry({ ...good, lunchOutManual: '' }),
            ).toContain('Both lunch times required or leave both empty');
        });

        it('flags lunch_out before clock_in', () => {
            expect(
                validateTimeEntry({ ...good, lunchOutManual: '08:00' }),
            ).toContain('Lunch out must be after clock in');
        });

        it('flags lunch_in not after lunch_out', () => {
            expect(
                validateTimeEntry({
                    ...good,
                    lunchOutManual: '12:30',
                    lunchInManual: '12:30',
                }),
            ).toContain('Lunch in must be after lunch out');
        });

        it('flags clock_out not after lunch_in', () => {
            expect(
                validateTimeEntry({
                    ...good,
                    lunchInManual: '17:00',
                    clockOutManual: '17:00',
                }),
            ).toContain('Clock out must be after lunch in');
        });
    });

    describe('checkLunchWarnings', () => {
        it('flags lunch > 60 minutes', () => {
            expect(checkLunchWarnings(61)).toEqual(['lunch_too_long']);
            expect(checkLunchWarnings(120)).toEqual(['lunch_too_long']);
        });

        it('flags lunch between 1 and 29 minutes as too short', () => {
            expect(checkLunchWarnings(1)).toEqual(['lunch_too_short']);
            expect(checkLunchWarnings(29)).toEqual(['lunch_too_short']);
        });

        it('treats 0 minutes (no lunch) as no warning', () => {
            expect(checkLunchWarnings(0)).toEqual([]);
        });

        it('treats exactly 30 and 60 as the safe band', () => {
            expect(checkLunchWarnings(30)).toEqual([]);
            expect(checkLunchWarnings(60)).toEqual([]);
        });
    });

    describe('getWarningMessage', () => {
        it('returns a human-readable message for known codes', () => {
            expect(getWarningMessage('lunch_too_long')).toMatch(/60 minutes/);
            expect(getWarningMessage('lunch_too_short')).toMatch(/30 minutes/);
        });

        it('falls back to the raw code for unknown warnings', () => {
            expect(getWarningMessage('mystery_warning')).toBe('mystery_warning');
        });
    });
});
