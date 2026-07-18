// Display-only timezone resolver tests. These cover the 'auto' sentinel
// behavior (OS-TZ tracking + re-resolution) and the persistence contract.
// All purely display-layer; none touch the canonical PT payroll TZ.

import {
  AUTO_TIMEZONE,
  DEFAULT_DISPLAY_TIMEZONE,
  getOSTimezone,
  resolveDisplayTimezone,
  getDisplayClock,
  formatInstantHHMM,
} from './timezones';

describe('timezones — auto / display resolvers', () => {
  it('DEFAULT_DISPLAY_TIMEZONE is the auto sentinel', () => {
    expect(DEFAULT_DISPLAY_TIMEZONE).toBe(AUTO_TIMEZONE);
    expect(DEFAULT_DISPLAY_TIMEZONE).toBe('auto');
  });

  it('getOSTimezone returns a non-empty IANA id', () => {
    const tz = getOSTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
    // Should contain a slash for a real IANA id (e.g. Europe/Istanbul), or be
    // the documented fallback. Either way it must be a usable Intl timeZone.
    expect(() =>
      new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    ).not.toThrow();
  });

  it("resolveDisplayTimezone('auto') === current OS timezone", () => {
    expect(resolveDisplayTimezone(AUTO_TIMEZONE)).toBe(getOSTimezone());
  });

  it("resolveDisplayTimezone returns a concrete IANA id unchanged (manual override)", () => {
    expect(resolveDisplayTimezone('Europe/Istanbul')).toBe('Europe/Istanbul');
    expect(resolveDisplayTimezone('America/Los_Angeles')).toBe('America/Los_Angeles');
  });

  it("getDisplayClock('auto') resolves the OS TZ and never leaks the 'auto' sentinel as zoneName", () => {
    const clock = getDisplayClock(AUTO_TIMEZONE);
    expect(clock.zoneName).not.toBe(AUTO_TIMEZONE);
    expect(clock.zoneName).toBe(getOSTimezone());
    // Date/time strings are well-formed (YYYY-MM-DD / HH:MM).
    expect(clock.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(clock.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('getDisplayClock with a manual IANA id formats in that zone', () => {
    const clock = getDisplayClock('America/Los_Angeles');
    expect(clock.zoneName).toBe('America/Los_Angeles');
    expect(clock.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(clock.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formatInstantHHMM formats a fixed instant in the given zone (manual id)', () => {
    // 2026-07-18T18:40:00Z = 11:40 PT, 21:40 Istanbul.
    const epoch = Date.UTC(2026, 6, 18, 18, 40, 0);
    expect(formatInstantHHMM(epoch, 'America/Los_Angeles')).toBe('11:40');
    expect(formatInstantHHMM(epoch, 'Europe/Istanbul')).toBe('21:40');
  });

  it('formatInstantHHMM with auto resolves the OS TZ (matches getOSTimezone)', () => {
    const epoch = Date.now();
    expect(formatInstantHHMM(epoch, AUTO_TIMEZONE)).toBe(
      formatInstantHHMM(epoch, getOSTimezone()),
    );
  });

  it('formatInstantHHMM output matches HH:MM shape', () => {
    expect(formatInstantHHMM(Date.now(), 'America/Los_Angeles')).toMatch(/^\d{2}:\d{2}$/);
  });
});
