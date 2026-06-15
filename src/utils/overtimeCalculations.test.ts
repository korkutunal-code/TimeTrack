import {
    WORKWEEK_START_DAYS,
    DEFAULT_WORKWEEK_START_DAY,
    getWorkWeekStartDate,
    calculateDailyOvertimeBreakdown,
    calculateWeeklyOvertimeAdjustments,
    getEntriesForWorkweek,
    calculateBiweeklyOvertimeTotals,
} from './overtimeCalculations';

describe('overtimeCalculations - California rules', () => {
    describe('constants', () => {
        it('workweek enum matches JS getDay() ordering', () => {
            expect(WORKWEEK_START_DAYS.SUNDAY).toBe(0);
            expect(WORKWEEK_START_DAYS.SATURDAY).toBe(6);
            expect(DEFAULT_WORKWEEK_START_DAY).toBe(0); // default Sunday
        });
    });

    describe('getWorkWeekStartDate', () => {
        it('returns the same date when it already is the workweek start', () => {
            // 2025-01-05 is a Sunday
            expect(getWorkWeekStartDate('2025-01-05', 0)).toBe('2025-01-05');
        });

        it('walks back to the previous Sunday by default', () => {
            // Wed 2025-01-08 -> Sun 2025-01-05
            expect(getWorkWeekStartDate('2025-01-08')).toBe('2025-01-05');
        });

        it('respects a custom workweek start day (Monday)', () => {
            // Wed 2025-01-08 -> Mon 2025-01-06
            expect(getWorkWeekStartDate('2025-01-08', 1)).toBe('2025-01-06');
        });

        it('crosses month boundaries correctly', () => {
            // Wed 2025-02-05 -> Sun 2025-02-02
            expect(getWorkWeekStartDate('2025-02-05', 0)).toBe('2025-02-02');
            // Sat 2025-03-01 with Monday start -> Mon 2025-02-24
            expect(getWorkWeekStartDate('2025-03-01', 1)).toBe('2025-02-24');
        });
    });

    describe('calculateDailyOvertimeBreakdown', () => {
        it('classifies 0-8h as all regular', () => {
            expect(calculateDailyOvertimeBreakdown(0)).toEqual({
                regularMinutes: 0,
                otMinutes: 0,
                doubleTimeMinutes: 0,
            });
            expect(calculateDailyOvertimeBreakdown(480)).toEqual({
                regularMinutes: 480,
                otMinutes: 0,
                doubleTimeMinutes: 0,
            });
        });

        it('classifies 8-12h as regular + OT', () => {
            // 10h -> 8h regular + 2h OT
            expect(calculateDailyOvertimeBreakdown(600)).toEqual({
                regularMinutes: 480,
                otMinutes: 120,
                doubleTimeMinutes: 0,
            });
            // Exactly 12h -> 8h regular + 4h OT
            expect(calculateDailyOvertimeBreakdown(720)).toEqual({
                regularMinutes: 480,
                otMinutes: 240,
                doubleTimeMinutes: 0,
            });
        });

        it('classifies >12h into double-time', () => {
            // 14h -> 8h reg + 4h OT + 2h DT
            expect(calculateDailyOvertimeBreakdown(840)).toEqual({
                regularMinutes: 480,
                otMinutes: 240,
                doubleTimeMinutes: 120,
            });
        });

        it('sum of buckets always equals total', () => {
            for (const total of [0, 250, 480, 600, 720, 840, 1000]) {
                const b = calculateDailyOvertimeBreakdown(total);
                expect(b.regularMinutes + b.otMinutes + b.doubleTimeMinutes).toBe(total);
            }
        });
    });

    describe('calculateWeeklyOvertimeAdjustments', () => {
        it('leaves a <40h week untouched', () => {
            const week = [
                { workDate: '2025-01-06', totalWorkMinutes: 480 }, // 8h
                { workDate: '2025-01-07', totalWorkMinutes: 480 }, // 8h
                { workDate: '2025-01-08', totalWorkMinutes: 480 }, // 8h
                { workDate: '2025-01-09', totalWorkMinutes: 480 }, // 8h
            ]; // total 32h regular
            const out = calculateWeeklyOvertimeAdjustments(week);
            expect(out).toHaveLength(4);
            for (const e of out) {
                expect(e.regularMinutes).toBe(480);
                expect(e.otMinutes || 0).toBe(0);
                expect(e.weeklyOtAdjustment).toBeUndefined();
            }
        });

        it('converts >40h regular time into weekly OT (LIFO from latest day)', () => {
            // 5 * 9h = 45h total. Daily breakdown: each day = 8h reg + 1h OT.
            // Weekly reg total = 5 * 8 = 40h exactly -> no weekly adjustment.
            const week = Array.from({ length: 5 }, (_, i) => ({
                workDate: `2025-01-${String(6 + i).padStart(2, '0')}`,
                totalWorkMinutes: 540, // 9h
            }));
            const out = calculateWeeklyOvertimeAdjustments(week);
            const totalReg = out.reduce((s, e) => s + (e.regularMinutes || 0), 0);
            const totalOT = out.reduce((s, e) => s + (e.otMinutes || 0), 0);
            expect(totalReg).toBe(2400); // 40h regular
            expect(totalOT).toBe(5 * 60); // 5h daily OT
        });

        it('[BUG TT-OT-001 FIXED] moves only the excess (2h) to OT on the latest day', () => {
            const week = Array.from({ length: 6 }, (_, i) => ({
                workDate: `2025-01-${String(6 + i).padStart(2, '0')}`,
                totalWorkMinutes: 420, // 7h
            }));
            const out = calculateWeeklyOvertimeAdjustments(week);
            const totalReg = out.reduce((s, e) => s + (e.regularMinutes || 0), 0);
            const totalOT = out.reduce((s, e) => s + (e.otMinutes || 0), 0);
            expect(totalReg).toBe(2400); // 40h regular
            expect(totalOT).toBe(120); // only 2h weekly OT

            const adjusted = out.filter(
                (e) => e.weeklyOtAdjustment && e.weeklyOtAdjustment > 0,
            );
            expect(adjusted).toHaveLength(1);
            expect(adjusted[0].workDate).toBe('2025-01-11');
            expect(adjusted[0].weeklyOtAdjustment).toBe(120);
        });

        it('preserves pre-calculated daily breakdown when regularMinutes already set', () => {
            const week = [
                {
                    workDate: '2025-01-06',
                    totalWorkMinutes: 480,
                    regularMinutes: 480,
                    otMinutes: 0,
                    doubleTimeMinutes: 0,
                },
            ];
            const out = calculateWeeklyOvertimeAdjustments(week);
            expect(out[0].regularMinutes).toBe(480);
            expect(out[0].otMinutes).toBe(0);
        });
    });

    describe('getEntriesForWorkweek', () => {
        const all = [
            { workDate: '2025-01-04' }, // Sat prev week
            { workDate: '2025-01-05' }, // Sun start
            { workDate: '2025-01-08' }, // Wed
            { workDate: '2025-01-11' }, // Sat same week
            { workDate: '2025-01-12' }, // Sun next week
        ];

        it('returns inclusive start, exclusive next-week start', () => {
            const out = getEntriesForWorkweek(all, '2025-01-05');
            expect(out.map((e) => e.workDate)).toEqual([
                '2025-01-05',
                '2025-01-08',
                '2025-01-11',
            ]);
        });

        it('returns empty array when no entries match', () => {
            const out = getEntriesForWorkweek(all, '2030-01-01');
            expect(out).toEqual([]);
        });
    });

    describe('calculateBiweeklyOvertimeTotals', () => {
        it('aggregates grand totals and per-week breakdown correctly', () => {
            // Week 1 (Sun 2025-01-05): 5 * 8h = 40h regular exactly
            // Week 2 (Sun 2025-01-12): 5 * 10h = 50h -> 40h reg + 10h OT (all daily OT, no weekly)
            const w1 = Array.from({ length: 5 }, (_, i) => ({
                workDate: `2025-01-${String(6 + i).padStart(2, '0')}`,
                totalWorkMinutes: 480,
            }));
            const w2 = Array.from({ length: 5 }, (_, i) => ({
                workDate: `2025-01-${String(13 + i).padStart(2, '0')}`,
                totalWorkMinutes: 600,
            }));
            const out = calculateBiweeklyOvertimeTotals([...w1, ...w2]);

            expect(Object.keys(out.weeklyTotals).sort()).toEqual([
                '2025-01-05',
                '2025-01-12',
            ]);

            const w1Totals = out.weeklyTotals['2025-01-05'];
            expect(w1Totals.regularMinutes).toBe(2400);
            expect(w1Totals.otMinutes).toBe(0);

            const w2Totals = out.weeklyTotals['2025-01-12'];
            expect(w2Totals.regularMinutes).toBe(2400);
            expect(w2Totals.otMinutes).toBe(600); // 10h daily OT

            expect(out.grandTotals.regularMinutes).toBe(4800);
            expect(out.grandTotals.otMinutes).toBe(600);
            expect(out.grandTotals.doubleTimeMinutes).toBe(0);
            expect(out.grandTotals.totalMinutes).toBe(5400);
            expect(out.adjustedEntries).toHaveLength(10);
        });

        it('applies double-time correctly at biweekly scope', () => {
            // One heroic 14h day => 8h reg + 4h OT + 2h DT
            const entries = [{ workDate: '2025-01-06', totalWorkMinutes: 840 }];
            const out = calculateBiweeklyOvertimeTotals(entries);
            expect(out.grandTotals).toEqual({
                regularMinutes: 480,
                otMinutes: 240,
                doubleTimeMinutes: 120,
                totalMinutes: 840,
            });
        });

        it('handles empty input', () => {
            const out = calculateBiweeklyOvertimeTotals([]);
            expect(out.grandTotals).toEqual({
                regularMinutes: 0,
                otMinutes: 0,
                doubleTimeMinutes: 0,
                totalMinutes: 0,
            });
            expect(out.weeklyTotals).toEqual({});
            expect(out.adjustedEntries).toEqual([]);
        });
    });
});
