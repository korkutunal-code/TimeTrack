/**
 * Calendar-day helpers that respect a specific IANA timezone.
 *
 * Why: this app has employees in California, Turkey, and Thailand. `new Date('2024-03-15')`
 * is interpreted in the *runtime's* local timezone — which on a UTC server can put the
 * date one day off, breaking workweek boundaries, "yesterday" detection, and payroll.
 *
 * These helpers convert a wall-clock date (YYYY-MM-DD) into the canonical YYYY-MM-DD
 * string for the *employee's* timezone, not the server's.
 */

/**
 * Return the YYYY-MM-DD string for a given wall-clock instant in `timeZone`.
 * Uses Intl.DateTimeFormat (no external deps, DST-safe).
 *
 * @param date - The instant to format (default: now)
 * @param timeZone - IANA timezone name (default: runtime's local zone)
 * @returns YYYY-MM-DD in that timezone
 */
export function ymdInTZ(date: Date = new Date(), timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const y = parts.find(p => p.type === 'year')?.value ?? '0000';
    const m = parts.find(p => p.type === 'month')?.value ?? '01';
    const d = parts.find(p => p.type === 'day')?.value ?? '01';
    return `${y}-${m}-${d}`;
}

/**
 * Get the calendar-day difference (in whole days) between two YYYY-MM-DD strings,
 * evaluated in the given timezone. Positive when `bYmd` is after `aYmd`.
 *
 * Implementation: build UTC midnight for each YMD in the *target* zone, then
 * diff in ms. Using UTC midnight-of-the-zone-day keeps us safe from DST jumps.
 */
export function daysBetween(aYmd: string, bYmd: string, timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone): number {
    return Math.round((midnightUtcInZone(bYmd, timeZone) - midnightUtcInZone(aYmd, timeZone)) / (1000 * 60 * 60 * 24));
}

/**
 * Return the UTC ms for "midnight of the given YMD in the given timezone".
 * Internally uses a 2-pass offset solve (see seed_client.ts for the same trick) to
 * survive DST transitions.
 */
export function midnightUtcInZone(ymd: string, timeZone: string): number {
    const [y, m, d] = ymd.split('-').map(Number);
    if (!y || !m || !d) return NaN;

    const offsetAt = (utcMs: number): number => {
        const dtf = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
        const parts = dtf.formatToParts(new Date(utcMs));
        const g = (t: string) => Number(parts.find(p => p.type === t)?.value);
        let h = g('hour');
        if (h === 24) h = 0;
        return Date.UTC(g('year'), g('month') - 1, g('day'), h, g('minute'), g('second')) - utcMs;
    };

    const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
    const off1 = offsetAt(guess);
    const firstPass = guess - off1;
    const off2 = offsetAt(firstPass);
    return guess - off2;
}

/**
 * Shift a YYYY-MM-DD string by N calendar days. Negative N = go back.
 * Operates in the given timezone so the calendar day is consistent.
 */
export function shiftYmd(ymd: string, days: number): string {
    const [y, m, d] = ymd.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

/**
 * Parse 'YYYY-MM-DD' into a UTC-anchored Date. Use this when the user-supplied
 * date is meant to be a *calendar date* (no timezone). Do NOT use it for instants.
 */
export function parseYmdAsUtcMidnight(ymd: string): Date {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Get the day-of-week (0=Sun..6=Sat) of a YYYY-MM-DD string.
 * Uses UTC interpretation, so it's stable regardless of runtime TZ.
 */
export function dayOfWeekUTC(ymd: string): number {
    const dt = parseYmdAsUtcMidnight(ymd);
    return dt.getUTCDay();
}
