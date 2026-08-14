import {
  decideShiftAutoClose,
  decideLunchAutoEnd,
  detectGuardrailWarning,
  REMOTE_MAX_SHIFT_MS,
  LUNCH_AUTO_END_MS,
} from './shiftGuardrails';
import { epochFromLocalWallTime } from './timeCalculations';

// Asia/Bangkok (UTC+07:00) has no DST, so wall-clock ↔ epoch math is
// deterministic and avoids the DST-transition ambiguity in the test fixtures.
const TZ = 'Asia/Bangkok';
const DATE = '2026-08-14';

describe('shiftGuardrails — decideShiftAutoClose (On-site 10 PM)', () => {
  const clockIn = epochFromLocalWallTime('08:00', DATE, TZ)!;
  const closeAt = epochFromLocalWallTime('22:00', DATE, TZ)!;

  it('auto-closes at 22:00 local once past 10 PM', () => {
    const d = decideShiftAutoClose({
      nowMs: closeAt + 60_000,
      workModel: 'On-site',
      shift: { clockInSystem: clockIn, complete: false },
      timezone: TZ,
    });
    expect(d.reason).toBe('on_site_10pm');
    expect(d.actionAtMs).toBe(closeAt);
    expect(d.actionManual).toBe('22:00');
  });

  it('does not close before 10 PM', () => {
    const d = decideShiftAutoClose({
      nowMs: closeAt - 60_000,
      workModel: 'On-site',
      shift: { clockInSystem: clockIn, complete: false },
      timezone: TZ,
    });
    expect(d.reason).toBeNull();
    expect(d.actionAtMs).toBeNull();
  });

  it('clocked in after 10 PM closes at next-day 10 PM', () => {
    const lateIn = epochFromLocalWallTime('23:00', DATE, TZ)!;
    const nextClose = epochFromLocalWallTime('22:00', '2026-08-15', TZ)!;
    const d = decideShiftAutoClose({
      nowMs: nextClose + 60_000,
      workModel: 'On-site',
      shift: { clockInSystem: lateIn, complete: false },
      timezone: TZ,
    });
    expect(d.reason).toBe('on_site_10pm');
    expect(d.actionAtMs).toBe(nextClose);
  });

  it('never acts on a completed shift', () => {
    const d = decideShiftAutoClose({
      nowMs: closeAt + 60_000,
      workModel: 'On-site',
      shift: { clockInSystem: clockIn, complete: true },
      timezone: TZ,
    });
    expect(d.reason).toBeNull();
  });

  it('never acts when clock-in has no system timestamp', () => {
    const d = decideShiftAutoClose({
      nowMs: closeAt + 60_000,
      workModel: 'On-site',
      shift: { complete: false },
      timezone: TZ,
    });
    expect(d.reason).toBeNull();
  });
});

describe('shiftGuardrails — decideShiftAutoClose (Remote 12h)', () => {
  const clockIn = Date.UTC(2026, 7, 14, 1, 0, 0);

  it('auto-closes at 12h elapsed', () => {
    const d = decideShiftAutoClose({
      nowMs: clockIn + REMOTE_MAX_SHIFT_MS + 1,
      workModel: 'Remote',
      shift: { clockInSystem: clockIn, complete: false },
      timezone: TZ,
    });
    expect(d.reason).toBe('remote_12h');
    expect(d.actionAtMs).toBe(clockIn + REMOTE_MAX_SHIFT_MS);
  });

  it('does not close before 12h', () => {
    const d = decideShiftAutoClose({
      nowMs: clockIn + REMOTE_MAX_SHIFT_MS - 1,
      workModel: 'Remote',
      shift: { clockInSystem: clockIn, complete: false },
      timezone: TZ,
    });
    expect(d.reason).toBeNull();
  });

  it('treats any non-Remote model as On-site', () => {
    const d = decideShiftAutoClose({
      nowMs: clockIn + REMOTE_MAX_SHIFT_MS + 1,
      workModel: 'On-site',
      shift: { clockInSystem: clockIn, complete: false },
      timezone: TZ,
    });
    expect(d.reason).not.toBe('remote_12h');
  });
});

describe('shiftGuardrails — decideLunchAutoEnd (1h lunch)', () => {
  const lunchOut = Date.UTC(2026, 7, 14, 12, 0, 0);
  const clockIn = Date.UTC(2026, 7, 14, 8, 0, 0);

  it('ends lunch at 60m', () => {
    const d = decideLunchAutoEnd({
      nowMs: lunchOut + LUNCH_AUTO_END_MS + 1,
      shift: { clockInSystem: clockIn, lunchOutSystem: lunchOut, complete: false },
    });
    expect(d.reason).toBe('lunch_1h');
    expect(d.actionAtMs).toBe(lunchOut + LUNCH_AUTO_END_MS);
  });

  it('does not end before 60m', () => {
    const d = decideLunchAutoEnd({
      nowMs: lunchOut + LUNCH_AUTO_END_MS - 1,
      shift: { clockInSystem: clockIn, lunchOutSystem: lunchOut, complete: false },
    });
    expect(d.reason).toBeNull();
  });

  it('skips when lunch already ended or was skipped', () => {
    expect(
      decideLunchAutoEnd({
        nowMs: lunchOut + LUNCH_AUTO_END_MS + 1,
        shift: { clockInSystem: clockIn, lunchOutSystem: lunchOut, lunchInSystem: lunchOut + 30 * 60_000, complete: false },
      }).reason,
    ).toBeNull();
    expect(
      decideLunchAutoEnd({
        nowMs: lunchOut + LUNCH_AUTO_END_MS + 1,
        shift: { clockInSystem: clockIn, lunchOutSystem: lunchOut, skipLunch: true, complete: false },
      }).reason,
    ).toBeNull();
  });

  it('skips when never on lunch', () => {
    expect(
      decideLunchAutoEnd({ nowMs: lunchOut + LUNCH_AUTO_END_MS + 1, shift: { clockInSystem: clockIn, complete: false } }).reason,
    ).toBeNull();
  });
});

describe('shiftGuardrails — detectGuardrailWarning', () => {
  it('flags auto-closed entries (entry level)', () => {
    expect(detectGuardrailWarning([{ autoClosed: true }]).hasWarning).toBe(true);
  });

  it('flags auto-ended-lunch segments', () => {
    expect(detectGuardrailWarning([{ segments: [{ autoEndedLunch: true }] }]).hasWarning).toBe(true);
  });

  it('flags current-segment markers', () => {
    expect(detectGuardrailWarning([{ currentSegment: { autoClosed: true } }]).hasWarning).toBe(true);
  });

  it('ignores voided / archived / corrected entries', () => {
    expect(detectGuardrailWarning([{ autoClosed: true, status: 'voided' }]).hasWarning).toBe(false);
    expect(detectGuardrailWarning([{ autoClosed: true, status: 'archived' }]).hasWarning).toBe(false);
    expect(detectGuardrailWarning([{ autoClosed: true, status: 'corrected' }]).hasWarning).toBe(false);
  });

  it('no warning when nothing is flagged', () => {
    expect(detectGuardrailWarning([{ status: 'active' }]).hasWarning).toBe(false);
    expect(detectGuardrailWarning([]).hasWarning).toBe(false);
  });
});
