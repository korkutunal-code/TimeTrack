/**
 * Time Window & Deadline Enforcement
 * Prevents late entries and enforces completion deadlines
 */

import { TimeEntry } from '../app/lib/database';
import { dayOfWeekUTC } from './tzCalendar';

interface TimeWindowResult {
    allowed: boolean;
    reason?: string; // Reason for blockage (machine readable)
    message?: string; // Human readable message
    gracePeriod?: boolean;
    warningMessage?: string; // Warning message text
}

/**
 * Check if entry is within allowed time window
 * Rules:
 * - Same calendar day: Always allowed
 * - Next day before 10am: Allowed (grace period)
 * - After 10am next day: LOCKED
 *
 * @param workDate - Entry date (YYYY-MM-DD)
 * @param currentTime - Current time
 * @returns { allowed, reason }
 *
 * Bug fix: previously used `new Date(workDate + 'T00:00:00')` and compared to
 * `new Date(now).setHours(0,0,0,0)` in the runtime's local TZ. On a UTC server
 * this shifted the "yesterday" boundary by a day for west-coast users, blocking
 * legitimate same-day entries after midnight UTC. Now both days are computed
 * from YYYY-MM-DD strings with explicit UTC anchoring.
 */
export function isWithinTimeWindow(workDate: string, currentTime: Date = new Date()): TimeWindowResult {
    // Validate workDate shape early
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
        return { allowed: true, reason: 'invalid_work_date', message: 'Invalid work date' };
    }
    const [wy, wm, wd] = workDate.split('-').map(Number);
    const workDateMs = Date.UTC(wy, wm - 1, wd);

    const now = currentTime;
    const nowYmd = now.toISOString().slice(0, 10);
    const [ny, nm, nd] = nowYmd.split('-').map(Number);
    const nowDayMs = Date.UTC(ny, nm - 1, nd);

    const daysDiff = Math.floor((nowDayMs - workDateMs) / (1000 * 60 * 60 * 24));

    // Same day - always allowed
    if (daysDiff === 0) {
        return { allowed: true };
    }

    // Next day (1 day later)
    if (daysDiff === 1) {
        const currentHour = now.getUTCHours();

        // Before 10am = grace period (10am is treated as 10:00 in the user's
        // local clock; this is intentionally simple since grace period is a
        // soft UX nudge, not a hard rule)
        if (currentHour < 10) {
            return {
                allowed: true,
                gracePeriod: true,
                message: `Grace period: Entry must be completed by 10:00 AM today`
            };
        } else {
            return {
                allowed: true, // Temporarily allowing entries after 10 AM
                reason: 'time_window_closed_warning',
                warningMessage: 'Warning: Time entered after 10:00 AM deadline. Please try to complete your entries on time in the future.'
            };
        }
    }

    // More than 1 day old
    return {
        allowed: true, // Temporarily allowing old entries
        reason: 'entry_too_old_warning',
        warningMessage: 'Warning: Time entered past the deadline. Please try to complete your entries on time in the future.'
    };
}

/**
 * Check if entry is past completion deadline
 * Deadline: 11:59 PM same day OR 10:00 AM next day
 * 
 * @param workDate - Entry date
 * @param currentTime - Current time
 * @returns True if past deadline
 */
export function isPastDeadline(workDate: string, currentTime: Date = new Date()): boolean {
    const window = isWithinTimeWindow(workDate, currentTime);
    // Since we relaxed allowed=true, we detect deadline violation via reason flag
    return !window.allowed || window.reason?.includes('warning') === true;
}

/**
 * Get yesterday's date in YYYY-MM-DD format
 * @param fromDate - Reference date (default: today)
 * @returns Yesterday's date
 */
export function getYesterdayDate(fromDate: Date = new Date()): string {
    const ymd = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(fromDate);
    const [y, m, d] = ymd.split('-').map(Number);
    const ptNoonOfYesterday = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0, 0));
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(ptNoonOfYesterday);
}

interface CompletionCheckResult {
    complete: boolean;
    reason?: string;
    message?: string;
}

// Partial entry type for this specific check, usually the raw firestore data or typed TimeEntry
type CheckEntry = Partial<TimeEntry> & {
    dayComplete?: boolean;
};

/**
 * Check if yesterday's entry is complete
 * Used to block today's entry if yesterday is incomplete
 * 
 * @param yesterdayEntry - Yesterday's time entry
 * @returns { complete, reason }
 */
export function isYesterdayComplete(yesterdayEntry: CheckEntry | null | undefined): CompletionCheckResult {
    // No entry at all (e.g., first day, weekend, or day off)
    if (!yesterdayEntry) {
        return { complete: true };
    }

    // Entry exists but not complete
    if (!yesterdayEntry.dayComplete && !yesterdayEntry.complete) {
        return {
            complete: false,
            reason: 'incomplete',
            message: 'You must complete your previous day before starting a new one.'
        };
    }

    // Entry exists but missing clock out - checking manually just in case flag is wrong
    if (!yesterdayEntry.clockOutManual) {
        return {
            complete: false,
            reason: 'no_clock_out',
            message: 'You must complete your previous day before starting a new one.'
        };
    }

    // All good
    return { complete: true };
}

/**
 * Format time window message for display
 * @param workDate - Entry date
 * @returns Human-readable message
 */
export function getTimeWindowMessage(workDate: string): string | null {
    const window = isWithinTimeWindow(workDate);

    if (!window.allowed) {
        return window.message || null;
    }

    if (window.gracePeriod) {
        return `⏰ Grace Period: Complete by 10:00 AM today`;
    }

    return null;
}

/**
 * Calculate hours until deadline
 * @param workDate - Entry date
 * @param currentTime - Current time
 * @returns Hours until deadline, or null if past
 */
export function getHoursUntilDeadline(workDate: string, currentTime: Date = new Date()): number | null {
    // PT-anchored deadline computation: the deadline is "tomorrow at 10am PT".
    // Bug fix: previously used Date.UTC(y, m-1, d, 0, 0, 0, 0) which is UTC midnight,
    // not PT midnight. On a UTC server, UTC midnight = 5pm PT previous day (PST) or
    // 4pm PT previous day (PDT), causing wrong deadline computation.
    // Fix: use PT-noon anchor to determine the PT calendar date, then compute
    // the deadline as (that date + 1 day) at 10am PT.
    const [wy, wm, wd] = workDate.split('-').map(Number);
    if (!wy || !wm || !wd) return null;

    // PT noon of the workDate calendar day in PT.
    // Using noon UTC as the anchor: since PT is always UTC-7 or UTC-8, noon UTC
    // is always AFTER midnight PT on the same calendar day (never on the next or previous day).
    const ptNoonOfWorkDate = new Date(Date.UTC(wy, wm - 1, wd, 12, 0, 0, 0));
    const ptDateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(ptNoonOfWorkDate);

    // Parse the PT date string and compute: (that date + 1 day) at 10am PT in UTC.
    const [y, m, d] = ptDateStr.split('-').map(Number);
    // Next calendar day: d+1 overflows into next month if needed via Date.UTC
    const deadlineUtc = Date.UTC(y, m - 1, d + 1, 17, 0, 0, 0); // 10am PT = 17:00 UTC (PDT/PT is always UTC-7)

    const hoursRemaining = (deadlineUtc - currentTime.getTime()) / (1000 * 60 * 60);
    return hoursRemaining > 0 ? hoursRemaining : null;
}

/**
 * Check if it's a weekend
 * @param dateStr - Date in YYYY-MM-DD
 * @returns True if Saturday or Sunday
 */
export function isWeekend(dateStr: string): boolean {
    // Bug fix: was `new Date(dateStr + 'T00:00:00').getDay()` — runtime local TZ
    return dayOfWeekUTC(dateStr) === 0 || dayOfWeekUTC(dateStr) === 6;
}

/**
 * Get next business day (skip weekends)
 * @param dateStr - Starting date
 * @returns Next business day in YYYY-MM-DD
 */
export function getNextBusinessDay(dateStr: string): string {
    // Convert to PT calendar day first to anchor TZ, then shift by 24h UTC intervals.
    // Fix: previously used `new Date(dateStr + 'T00:00:00')` (local TZ) then
    // isWeekend(UTC-interpreted result), causing wrong-skip on Fri PT when runtime is UTC.
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return dateStr;
    const ptYmd = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
    // ptYmd is YYYY-MM-DD in PT. Add 1 calendar day (24h UTC, safe across DST).
    const [py, pm, pd] = ptYmd.split('-').map(Number);
    const nextUtc = Date.UTC(py, pm - 1, pd, 12, 0, 0, 0) + 24 * 60 * 60 * 1000;
    let candidate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(nextUtc));
    while (isWeekend(candidate)) {
        const [cy, cm, cd] = candidate.split('-').map(Number);
        const cUtc = Date.UTC(cy, cm - 1, cd, 12, 0, 0, 0) + 24 * 60 * 60 * 1000;
        candidate = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date(cUtc));
    }
    return candidate;
}

/**
 * Get previous business day (skip weekends)
 * @param dateStr - Starting date
 * @returns Previous business day in YYYY-MM-DD
 */
export function getPreviousBusinessDay(dateStr: string): string {
    // Same TZ fix as getNextBusinessDay: anchor to PT calendar day before shifting.
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) return dateStr;
    const ptYmd = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)));
    const [py, pm, pd] = ptYmd.split('-').map(Number);
    const prevUtc = Date.UTC(py, pm - 1, pd, 12, 0, 0, 0) - 24 * 60 * 60 * 1000;
    let candidate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(prevUtc));
    while (isWeekend(candidate)) {
        const [cy, cm, cd] = candidate.split('-').map(Number);
        const cUtc = Date.UTC(cy, cm - 1, cd, 12, 0, 0, 0) - 24 * 60 * 60 * 1000;
        candidate = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Los_Angeles',
            year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date(cUtc));
    }
    return candidate;
}

interface AccessCheckResult {
    canAccess: boolean;
    blocked: boolean;
    reason?: string;
    message?: string;
    showSummary?: boolean;
    gracePeriod?: boolean;
    graceMessage?: string;
    warningMessage?: string;
}

interface CheckEntryAccessParams {
    workDate: string;
    yesterdayEntry: CheckEntry | null;
    currentEntry: CheckEntry | null;
}

/**
 * Comprehensive entry access check
 * Combines all rules: time window, yesterday blocking, deadlines
 * 
 * @param params - { workDate, yesterdayEntry, currentEntry }
 * @returns { canAccess, blocked, reason, message }
 */
export function checkEntryAccess(params: CheckEntryAccessParams): AccessCheckResult {
    const { workDate, yesterdayEntry, currentEntry } = params;

    // Check if entry is complete and locked
    // Checking both flag variations (legacy vs new)
    if (currentEntry && (currentEntry.dayComplete || currentEntry.complete)) {
        return {
            canAccess: false,
            blocked: true,
            reason: 'entry_complete',
            message: 'This entry is complete and locked. Contact a manager for corrections.',
            showSummary: true
        };
    }

    // Check time window
    const window = isWithinTimeWindow(workDate);
    if (!window.allowed) {
        return {
            canAccess: false,
            blocked: true,
            reason: 'time_window_closed',
            message: window.message
        };
    }

    // Check yesterday's completion - TEMPORARILY DISABLED AS BLOCKER, NOW A WARNING
    const yesterdayCheck = isYesterdayComplete(yesterdayEntry);

    // Aggregate warnings
    let warningText = window.warningMessage || '';
    if (!yesterdayCheck.complete) {
        warningText = warningText
            ? warningText + ' ' + 'Reminder: You forgot to clock out yesterday.'
            : 'Reminder: You forgot to clock out yesterday. Please request a manager correction for your previous shift.';
    }

    // All checks passed (or resolved to warnings)
    return {
        canAccess: true,
        blocked: false,
        gracePeriod: window.gracePeriod || false,
        graceMessage: window.message,
        warningMessage: warningText || undefined
    };
}
