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

// =============================================================================
// PT Timezone Safety Regression Tests
// Ref: AGENTS.md §2 Guardrails — canonical timezone is America/Los_Angeles
// for all payroll math and storage. Never use browser Date directly.
// =============================================================================
import {
    getCurrentPTDate,
    getCurrentPTTimeHHMM,
    getPTDate,
    getPTWeekStart,
} from './timeCalculations';

describe('PT helpers — timezone safety (W2 audit)', () => {
    /**
     * getCurrentPTDate: must return the correct PT calendar date regardless of
     * the runtime's local timezone. Pin with known UTC instants.
     */
    describe('getCurrentPTDate', () => {
        it('returns PT 2026-06-15 when UTC is 2026-06-15T19:00:00Z (12:00 PT noon)', () => {
            const fakeNow = new Date('2026-06-15T19:00:00Z');
            const savedDate = global.Date;
            const MockDate = class extends (savedDate as any) {
                constructor(...args: unknown[]) {
                    if (args.length === 0) super(fakeNow);
                    else super(...(args as unknown[]));
                }
            };
            (global as any).Date = MockDate;
            try {
                const result = getCurrentPTDate();
                expect(result).toBe('2026-06-15');
            } finally {
                (global as any).Date = savedDate;
            }
        });

        it('returns PT 2026-06-14 when UTC is 2026-06-15T06:30:00Z (23:30 PT prev day)', () => {
            // 2026-06-15T06:30:00Z = 23:30 PT on June 14 (previous calendar day)
            const fakeNow = new Date('2026-06-15T06:30:00Z');
            const savedDate = global.Date;
            const MockDate = class extends (savedDate as any) {
                constructor(...args: unknown[]) {
                    if (args.length === 0) super(fakeNow);
                    else super(...(args as unknown[]));
                }
            };
            (global as any).Date = MockDate;
            try {
                const result = getCurrentPTDate();
                expect(result).toBe('2026-06-14');
            } finally {
                (global as any).Date = savedDate;
            }
        });

        it('PT date differs from UTC date near midnight PT boundary', () => {
            // 2026-06-15T06:59:59Z = 23:59 PT on June 14
            const fakeNow = new Date('2026-06-15T06:59:59Z');
            const savedDate = global.Date;
            const MockDate = class extends (savedDate as any) {
                constructor(...args: unknown[]) {
                    if (args.length === 0) super(fakeNow);
                    else super(...(args as unknown[]));
                }
            };
            (global as any).Date = MockDate;
            try {
                const result = getCurrentPTDate();
                expect(result).toBe('2026-06-14');
            } finally {
                (global as any).Date = savedDate;
            }
        });
    });

    /**
     * getCurrentPTTimeHHMM: must return wall-clock HH:MM in PT regardless of runtime TZ.
     */
    describe('getCurrentPTTimeHHMM', () => {
        it('returns 12:00 when UTC is 2026-06-15T19:00:00Z (noon PT)', () => {
            const fakeNow = new Date('2026-06-15T19:00:00Z');
            const savedDate = global.Date;
            const MockDate = class extends (savedDate as any) {
                constructor(...args: unknown[]) {
                    if (args.length === 0) super(fakeNow);
                    else super(...(args as unknown[]));
                }
            };
            (global as any).Date = MockDate;
            try {
                const result = getCurrentPTTimeHHMM();
                expect(result).toBe('12:00');
            } finally {
                (global as any).Date = savedDate;
            }
        });

        it('returns 23:30 when UTC is 2026-06-15T06:30:00Z (23:30 PT prev day)', () => {
            const fakeNow = new Date('2026-06-15T06:30:00Z');
            const savedDate = global.Date;
            const MockDate = class extends (savedDate as any) {
                constructor(...args: unknown[]) {
                    if (args.length === 0) super(fakeNow);
                    else super(...(args as unknown[]));
                }
            };
            (global as any).Date = MockDate;
            try {
                const result = getCurrentPTTimeHHMM();
                expect(result).toBe('23:30');
            } finally {
                (global as any).Date = savedDate;
            }
        });
    });

    /**
     * getPTDate: must convert a JS Date to the correct PT YYYY-MM-DD.
     */
    describe('getPTDate', () => {
        it('maps a UTC noon instant to PT Jun 15', () => {
            const utcNoon = new Date('2026-06-15T12:00:00Z');
            expect(getPTDate(utcNoon)).toBe('2026-06-15');
        });

        it('maps a UTC late-night instant to prior PT day (Jun 14)', () => {
            const utcLateNight = new Date('2026-06-15T06:30:00Z');
            expect(getPTDate(utcLateNight)).toBe('2026-06-14');
        });
    });

    /**
     * getPTWeekStart: PT week always starts on Sunday (DEFAULT_WORKWEEK_START_DAY = 0).
     */
    describe('getPTWeekStart', () => {
        it('returns the same PT Sunday when given a PT Sunday', () => {
            expect(getPTWeekStart('2026-06-14')).toBe('2026-06-14'); // Jun 14 2026 = Sunday
        });

        it('returns the preceding PT Sunday for a PT Monday', () => {
            expect(getPTWeekStart('2026-06-15')).toBe('2026-06-14'); // Jun 15 = Monday
        });

        it('returns the preceding PT Sunday for a PT Saturday', () => {
            expect(getPTWeekStart('2026-06-20')).toBe('2026-06-14'); // Jun 20 = Saturday
        });

        it('crosses month boundary: May Monday -> preceding May Sunday', () => {
            expect(getPTWeekStart('2026-05-04')).toBe('2026-05-03'); // May 4 = Monday
        });

        it('crosses month boundary: Sunday at month start returns same Sunday (not prior)', () => {
            expect(getPTWeekStart('2026-03-01')).toBe('2026-03-01'); // Mar 1 2026 = Sunday (same as June 14 case)
        });

        it('handles default argument without throwing', () => {
            expect(() => getPTWeekStart()).not.toThrow();
        });
    });
});
