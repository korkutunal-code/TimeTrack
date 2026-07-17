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
  /** Human-readable label in the Windows/.NET picker style: (UTC±HH:MM) Cities */
  label: string;
}

// A standard worldwide selection of major time zones. Offset shown is the
// standard (base) offset; the live clock via Intl handles DST automatically.
// No "Auto" / "Detect" option is included by design (manual selection only).
export const DISPLAY_TIMEZONES: TimeZoneOption[] = [
  { id: 'America/Los_Angeles', label: '(UTC-08:00) Pacific Time (US and Canada)' },
  { id: 'America/Denver', label: '(UTC-07:00) Mountain Time (US and Canada)' },
  { id: 'America/Chicago', label: '(UTC-06:00) Central Time (US and Canada)' },
  { id: 'America/Mexico_City', label: '(UTC-06:00) Mexico City' },
  { id: 'America/New_York', label: '(UTC-05:00) Eastern Time (US and Canada)' },
  { id: 'America/Sao_Paulo', label: '(UTC-03:00) Brasilia' },
  { id: 'America/Argentina/Buenos_Aires', label: '(UTC-03:00) Buenos Aires' },
  { id: 'Atlantic/South_Georgia', label: '(UTC-02:00) Mid-Atlantic' },
  { id: 'Atlantic/Azores', label: '(UTC-01:00) Azores' },
  { id: 'Europe/London', label: '(UTC+00:00) Dublin, Lisbon, London' },
  { id: 'Europe/Berlin', label: '(UTC+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna' },
  { id: 'Europe/Kyiv', label: '(UTC+02:00) Helsinki, Kyiv, Riga, Sofia, Tallinn, Vilnius' },
  { id: 'Europe/Moscow', label: '(UTC+03:00) Moscow, St. Petersburg' },
  { id: 'Asia/Tehran', label: '(UTC+03:30) Tehran' },
  { id: 'Asia/Dubai', label: '(UTC+04:00) Abu Dhabi, Muscat' },
  { id: 'Asia/Kabul', label: '(UTC+04:30) Kabul' },
  { id: 'Asia/Karachi', label: '(UTC+05:00) Islamabad, Karachi' },
  { id: 'Asia/Kolkata', label: '(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi' },
  { id: 'Asia/Kathmandu', label: '(UTC+05:45) Kathmandu' },
  { id: 'Asia/Dhaka', label: '(UTC+06:00) Astana, Dhaka' },
  { id: 'Asia/Bangkok', label: '(UTC+07:00) Bangkok, Hanoi, Jakarta' },
  { id: 'Asia/Shanghai', label: '(UTC+08:00) Beijing, Chongqing, Hong Kong, Urumqi' },
  { id: 'Asia/Tokyo', label: '(UTC+09:00) Osaka, Sapporo, Tokyo' },
  { id: 'Australia/Adelaide', label: '(UTC+09:30) Adelaide' },
  { id: 'Australia/Sydney', label: '(UTC+10:00) Canberra, Melbourne, Sydney' },
  { id: 'Pacific/Auckland', label: '(UTC+12:00) Auckland, Wellington' },
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
