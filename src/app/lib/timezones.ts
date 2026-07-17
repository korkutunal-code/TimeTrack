// Display-only timezone options for the header selector.
//
// IMPORTANT (AGENTS.md §2 Guardrails): This list and the `getDisplayClock`
// helper are used PURELY for UI display (the live date/time/zone label shown
// on the punch screen). They do NOT affect payroll math, storage, workDate,
// segment timestamps, or any value sent to the backend — all of which remain
// canonically in America/Los_Angeles. Selecting a zone here only changes what
// the user *sees* on this screen.

export interface TimeZoneOption {
  /** IANA timezone id used for Intl.DateTimeFormat formatting (handles DST). */
  id: string;
  /** UTC offset prefix, e.g. "UTC-08:00" (no parentheses). Shown in the trigger. */
  offset: string;
  /** Descriptive label (cities/regions) shown in the expanded dropdown after the offset. */
  label: string;
}

// A standard worldwide selection of major time zones. Offset shown is the
// standard (base) offset; the live clock via Intl handles DST automatically.
// No "Auto" / "Detect" option is included by design (manual selection only).
// Parentheses around the UTC offset are intentionally removed; city/country
// parentheticals (e.g. "(US and Canada)") are preserved.
export const DISPLAY_TIMEZONES: TimeZoneOption[] = [
  { id: 'America/Los_Angeles', offset: 'UTC-08:00', label: 'Pacific Time (US and Canada)' },
  { id: 'America/Denver', offset: 'UTC-07:00', label: 'Mountain Time (US and Canada)' },
  { id: 'America/Chicago', offset: 'UTC-06:00', label: 'Central Time (US and Canada)' },
  { id: 'America/Mexico_City', offset: 'UTC-06:00', label: 'Mexico City' },
  { id: 'America/New_York', offset: 'UTC-05:00', label: 'Eastern Time (US and Canada)' },
  { id: 'America/Sao_Paulo', offset: 'UTC-03:00', label: 'Brasilia' },
  { id: 'America/Argentina/Buenos_Aires', offset: 'UTC-03:00', label: 'Buenos Aires' },
  { id: 'Atlantic/South_Georgia', offset: 'UTC-02:00', label: 'Mid-Atlantic' },
  { id: 'Atlantic/Azores', offset: 'UTC-01:00', label: 'Azores' },
  { id: 'Europe/London', offset: 'UTC+00:00', label: 'Dublin, Lisbon, London' },
  { id: 'Europe/Berlin', offset: 'UTC+01:00', label: 'Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna' },
  { id: 'Europe/Kyiv', offset: 'UTC+02:00', label: 'Helsinki, Kyiv, Riga, Sofia, Tallinn, Vilnius' },
  { id: 'Europe/Istanbul', offset: 'UTC+03:00', label: 'İstanbul, Moscow, St. Petersburg' },
  { id: 'Asia/Tehran', offset: 'UTC+03:30', label: 'Tehran' },
  { id: 'Asia/Dubai', offset: 'UTC+04:00', label: 'Abu Dhabi, Muscat' },
  { id: 'Asia/Kabul', offset: 'UTC+04:30', label: 'Kabul' },
  { id: 'Asia/Karachi', offset: 'UTC+05:00', label: 'Islamabad, Karachi' },
  { id: 'Asia/Kolkata', offset: 'UTC+05:30', label: 'Chennai, Kolkata, Mumbai, New Delhi' },
  { id: 'Asia/Kathmandu', offset: 'UTC+05:45', label: 'Kathmandu' },
  { id: 'Asia/Dhaka', offset: 'UTC+06:00', label: 'Astana, Dhaka' },
  { id: 'Asia/Bangkok', offset: 'UTC+07:00', label: 'Bangkok, Hanoi, Jakarta' },
  { id: 'Asia/Shanghai', offset: 'UTC+08:00', label: 'Beijing, Chongqing, Hong Kong, Urumqi' },
  { id: 'Asia/Tokyo', offset: 'UTC+09:00', label: 'Osaka, Sapporo, Tokyo' },
  { id: 'Australia/Adelaide', offset: 'UTC+09:30', label: 'Adelaide' },
  { id: 'Australia/Sydney', offset: 'UTC+10:00', label: 'Canberra, Melbourne, Sydney' },
  { id: 'Pacific/Auckland', offset: 'UTC+12:00', label: 'Auckland, Wellington' },
];

export const DEFAULT_DISPLAY_TIMEZONE = 'America/Los_Angeles';

export interface DisplayClock {
  date: string; // YYYY-MM-DD in the selected display zone
  time: string; // HH:MM (24h) in the selected display zone
  zoneName: string; // IANA zone id
}

/**
 * Compute the current date/time strings for DISPLAY ONLY in the given zone.
 * Reads the live instant (new Date()) and formats via Intl.DateTimeFormat.
 * Has no effect on stored data or calculations. Mirrors the PT helpers' format
 * (en-CA date, en-US 24h time) so the visual style stays consistent.
 */
export function getDisplayClock(timeZone: string): DisplayClock {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  return { date, time, zoneName: timeZone };
}
