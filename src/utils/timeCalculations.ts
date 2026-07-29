/**
 * Time Calculation Functions
 */

import { TimeEntry } from '../app/lib/database';

/**
 * Convert HH:MM time string to minutes since midnight
 * @param timeStr - Time string in HH:MM format
 * @returns Minutes since midnight
 */
export function timeToMinutes(timeStr: string | undefined | null): number {
    if (!timeStr || timeStr.trim() === '') return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

/**
 * Convert minutes to HH:MM format
 * @param minutes - Total minutes
 * @returns Time in HH:MM format
 */
export function minutesToTime(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Calculate lunch duration in minutes
 * @param lunchOut - Lunch out time (HH:MM)
 * @param lunchIn - Lunch in time (HH:MM)
 * @returns Lunch duration in minutes
 */
export function calculateLunchMinutes(lunchOut: string, lunchIn: string): number {
    if (!lunchOut || !lunchIn) return 0;
    const outMinutes = timeToMinutes(lunchOut);
    const inMinutes = timeToMinutes(lunchIn);
    return inMinutes - outMinutes;
}

/**
 * Calculate total work minutes
 * @param clockIn - Clock in time (HH:MM)
 * @param clockOut - Clock out time (HH:MM)
 * @param lunchMinutes - Lunch duration in minutes
 * @returns Total work minutes
 */
export function calculateTotalWorkMinutes(clockIn: string, clockOut: string, lunchMinutes: number): number {
    if (!clockIn || !clockOut) return 0;
    const inMinutes = timeToMinutes(clockIn);
    const outMinutes = timeToMinutes(clockOut);
    const totalMinutes = outMinutes - inMinutes;
    return totalMinutes - lunchMinutes;
}

/**
 * Compute the work minutes for a single shift segment from its raw clock/lunch
 * strings, subtracting lunch only when both endpoints are present and lunch
 * was not skipped. Result is clamped to >= 0.
 *
 * This is the CANONICAL lunch-aware shift-minutes implementation. It is shared
 * by `mapEntry` (via `deriveCurrentSegmentMinutes` in database.ts) and by the
 * TodayEntry submit flows (split-shift archive + clock-out) so that the day
 * total the UI writes stays in lock-step with the day total `mapEntry`
 * computes on the next read. Any change to lunch deduction logic MUST happen
 * here so all callers stay consistent.
 *
 * @param clockIn  - HH:MM (empty/undefined/whitespace → treated as 0)
 * @param clockOut - HH:MM (empty/undefined/whitespace → treated as 0)
 * @param skipLunch - true if lunch was skipped (no deduction)
 * @param lunchOut - HH:MM (empty/undefined → no deduction)
 * @param lunchIn  - HH:MM (empty/undefined → no deduction)
 * @returns Work minutes for the segment, clamped to >= 0.
 */
export function deriveSegmentWorkMinutes(
    clockIn: string | undefined | null,
    clockOut: string | undefined | null,
    skipLunch: boolean | undefined,
    lunchOut: string | undefined | null,
    lunchIn: string | undefined | null,
): number {
    const inM = timeToMinutes(clockIn);
    const outM = timeToMinutes(clockOut);
    let mins = outM - inM;
    if (!skipLunch && lunchOut && lunchIn) {
        mins -= timeToMinutes(lunchIn) - timeToMinutes(lunchOut);
    }
    return Math.max(0, mins);
}

/**
 * Format minutes to "Xh Ym" display format
 * @param minutes - Total minutes
 * @returns Formatted as "Xh Ym"
 */
export function formatMinutesToHoursMinutes(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
}

/**
 * Convert minutes to decimal hours (for admin view)
 * @param minutes - Total minutes
 * @returns Decimal hours (e.g., "8.5")
 */
export function minutesToDecimalHours(minutes: number): string {
    return (minutes / 60).toFixed(2);
}

/**
 * Convert decimal hours (e.g., 2.63) to a clean "H:MM" string (e.g., "2:38").
 * Rounds to the nearest minute. Handles negative / NaN gracefully.
 * @param decimalHours - Hours as a decimal number
 * @returns "H:MM" string — no leading zero on hours (e.g., "2:38", "0:05", "12:30")
 */
export function formatHoursHMM(decimalHours: number | null | undefined): string {
    if (decimalHours === null || decimalHours === undefined || Number.isNaN(Number(decimalHours))) {
        return '0:00';
    }
    const totalMinutes = Math.max(0, Math.round(Number(decimalHours) * 60));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
}

/**
 * Validate time entry and return array of errors
 * @param entry - Time entry object
 * @returns Array of error messages
 */
export function validateTimeEntry(entry: Partial<TimeEntry>): string[] {
    const errors: string[] = [];

    const clockIn = timeToMinutes(entry.clockInManual);
    const clockOut = timeToMinutes(entry.clockOutManual);
    const lunchOut = timeToMinutes(entry.lunchOutManual);
    const lunchIn = timeToMinutes(entry.lunchInManual);

    // Check if clock out is after clock in
    if (clockOut <= clockIn) {
        errors.push('Clock out must be after clock in');
    }

    // Check lunch times if provided
    const hasLunchOut = entry.lunchOutManual && entry.lunchOutManual.trim() !== '';
    const hasLunchIn = entry.lunchInManual && entry.lunchInManual.trim() !== '';

    // Both lunch times required or neither
    if (hasLunchOut !== hasLunchIn) {
        errors.push('Both lunch times required or leave both empty');
    }

    if (hasLunchOut && hasLunchIn) {
        // Lunch out must be after clock in
        if (lunchOut <= clockIn) {
            errors.push('Lunch out must be after clock in');
        }

        // Lunch in must be after lunch out
        if (lunchIn <= lunchOut) {
            errors.push('Lunch in must be after lunch out');
        }

        // Clock out must be after lunch in
        if (clockOut <= lunchIn) {
            errors.push('Clock out must be after lunch in');
        }
    }

    return errors;
}

/**
 * Check for lunch warnings (red flags)
 * @param lunchMinutes - Lunch duration in minutes
 * @returns Array of warning types
 */
export function checkLunchWarnings(lunchMinutes: number): string[] {
    const warnings: string[] = [];

    if (lunchMinutes > 60) {
        warnings.push('lunch_too_long');
    }

    if (lunchMinutes > 0 && lunchMinutes < 30) {
        warnings.push('lunch_too_short');
    }

    return warnings;
}

/**
 * Get human-readable warning message
 * @param warningType - Warning type code
 * @returns Human-readable message
 */
export function getWarningMessage(warningType: string): string {
    const messages: Record<string, string> = {
        'lunch_too_long': '⚠️ Lunch exceeds 60 minutes',
        'lunch_too_short': '⚠️ Lunch less than 30 minutes'
    };
    return messages[warningType] || warningType;
}

// ---------------------------------------------------------------------------
// America/Los_Angeles (company timezone) helpers — added for punch clock Phase 1
// All new punch code MUST use these for workDate, manual times, and week bounds.
// Display-only user.timezone never affects payroll math or storage.
// ---------------------------------------------------------------------------

/**
 * Current date in America/Los_Angeles as YYYY-MM-DD (logical work date).
 * Never uses raw browser local Date for payroll keys.
 */
export function getCurrentPTDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Current wall time in America/Los_Angeles as HH:MM (24h).
 * Used for clockInManual / clockOutManual etc in new punch flows.
 */
export function getCurrentPTTimeHHMM(): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return fmt.format(new Date());
}

/**
 * Convert a JS Date to PT YYYY-MM-DD (for history range queries etc).
 */
export function getPTDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Subtract N days from a PT YYYY-MM-DD date string, returning the PT YYYY-MM-DD.
 * Uses a PT-noon UTC anchor (matches getPTWeekStart) to avoid DST/midnight
 * off-by-one errors. Shared with clockService.subtractPTDays.
 */
export function subtractPTDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return getPTDate(new Date(Date.UTC(y, m - 1, d - days, 12, 0, 0)));
}

/**
 * Simple PT week start (Monday = 1, Mon–Sun workweek).
 * Returns YYYY-MM-DD of the Monday of the week containing the given PT date.
 */
export function getPTWeekStart(dateStr: string = getCurrentPTDate()): string {
  // Parse the PT date as local noon to avoid any DST boundary issues
  const [y, m, d] = dateStr.split('-').map(Number);
  // Create date in UTC representing that PT calendar day at noon PT
  const ptNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  // Get the weekday in PT (0=Sun ... 6=Sat) using long name (numeric not supported for weekday)
  const ptWeekdayStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday: 'long',
  }).format(ptNoon);
  const weekdayMap: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  const ptWeekday = weekdayMap[ptWeekdayStr] ?? 0;
  // Monday start: Mon=0 back, Tue=1, ..., Sun=6
  const daysBack = (ptWeekday + 6) % 7;
  const start = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  start.setUTCDate(start.getUTCDate() - daysBack);
  // Reuse the PT date formatter (the adjusted instant will resolve to correct PT calendar day)
  return getPTDate(start);
}

// ---------------------------------------------------------------------------
// Employee LOCAL timezone helpers
// The canonical storage/payroll timezone is America/Los_Angeles (PT) per
// AGENTS.md §2. The helpers below are for the employee-facing LOCAL calendar
// date/time used by the punch flows (entry doc ids, "since" banners, and the
// local-midnight shift split). They mirror the PT helpers' format (en-CA date,
// en-US 24h time) so behaviour stays consistent, but format in the employee's
// own IANA zone instead of PT. Per the local-time-tracking refactor, the
// employee's *local* calendar date drives their own time-entry documents.
// ---------------------------------------------------------------------------

/** Resolve the employee's effective local IANA zone (profile tz, else OS tz). */
export function getEmployeeTimezone(profileTimezone?: string | null): string {
  if (profileTimezone && typeof profileTimezone === 'string' && profileTimezone.trim() !== '') {
    return profileTimezone;
  }
  try {
    const tz = Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone;
    if (tz && typeof tz === 'string') return tz;
  } catch {
    // fall through
  }
  return 'America/Los_Angeles';
}

/** Current calendar date in the employee's local zone as YYYY-MM-DD. */
export function getLocalDate(timezone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: getEmployeeTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Current wall time in the employee's local zone as HH:MM (24h). */
export function getLocalTimeHHMM(timezone?: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: getEmployeeTimezone(timezone),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

/** Convert a JS Date to the employee's local YYYY-MM-DD (for range queries). */
export function getLocalDateFor(d: Date, timezone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: getEmployeeTimezone(timezone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Subtract N days from a local YYYY-MM-DD date string (returns local YYYY-MM-DD).
 * Uses a local-noon UTC anchor (matches getPTWeekStart) to avoid DST/midnight
 * off-by-one errors.
 */
export function subtractLocalDays(dateStr: string, days: number, timezone?: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return getLocalDateFor(new Date(Date.UTC(y, m - 1, d - days, 12, 0, 0)), timezone);
}

/**
 * Short IANA abbreviation for a timezone, e.g. "EST", "PDT", "UTC+3".
 * Derived from Intl's `timeZoneName: 'short'` part. Offset forms are
 * normalized to UTC ("GMT+3" → "UTC+3") to match the timezone selector's
 * UTC-offset formatting. Falls back to the offset form ("UTC-5") when a
 * short name isn't produced for the locale.
 */
export function getTimezoneAbbreviation(timezone?: string, date: Date = new Date()): string {
  const tz = getEmployeeTimezone(timezone);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZoneName: 'short',
    }).formatToParts(date);
    const name = parts.find((p) => p.type === 'timeZoneName')?.value;
    if (name && !/^[+-]?\d/.test(name)) {
      // Normalize offset-style "GMT±X" / "GMT" to "UTC±X" / "UTC" (Req 2a);
      // keep true abbreviations ("EST", "PDT", "CET") untouched.
      if (/^GMT([+-]\d+(:\d+)?)?$/i.test(name)) return name.replace(/^GMT/i, 'UTC');
      return name;
    }
  } catch {
    // fall through to offset form
  }
  // Offset fallback, e.g. "UTC-5".
  try {
    const offParts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(date);
    const off = offParts.find((p) => p.type === 'timeZoneName')?.value; // e.g. "GMT-5"
    if (off) return off.replace('GMT', 'UTC');
  } catch {
    // fall through
  }
  return tz;
}

/**
 * Format an epoch-millis instant as "H:MM AM/PM ABBR" in the employee's local
 * zone — for the punch "since" banner (Req 3). No date portion; includes the
 * short timezone abbreviation (e.g. "10:30 PM EST", "7:05 AM GMT+3").
 */
export function formatInstantLocalHHMMAbbr(epochMs: number, timezone?: string): string {
  const tz = getEmployeeTimezone(timezone);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(epochMs));
  return `${time} ${getTimezoneAbbreviation(tz, new Date(epochMs))}`;
}
