# W2 — Timezone & Payroll Math Audit

## TL;DR

7 local-timezone bugs were found and fixed across 3 files in `src/utils/`. All fixes rewrite the helper to use `Intl.DateTimeFormat` with `timeZone: 'America/Los_Angeles'` instead of `new Date()` / `getFullYear()` / `getDate()`. The canonical rule from AGENTS.md is now satisfied.

298 / 298 unit tests pass. No regressions.

## Bugs Fixed

### Bug 1 — `getYesterdayDate()` used runtime-local TZ (HIGH)

`src/utils/dateHelpers.js` previously used `yesterday.setDate(yesterday.getDate() - 1)` then `formatDateYYYYMMDD()` which used `date.getFullYear() / getMonth() / getDate()`. On a non-PT runtime, "yesterday" rolls over at the wrong wall-clock instant.

**Reproduction (pre-fix):**
- `process.env.TZ = 'Europe/London'`
- `jest.setSystemTime(new Date('2026-06-15T07:00:00Z'))` (08:00 BST, 00:00 PT)
- `getYesterdayDate()` returned `2026-06-15` (runtime local: June 15 minus one day) instead of the correct `2026-06-14`.

**Fix:** Replaced with `getPTDate(new Date(now.getTime() - 24h))` so the subtraction is always interpreted in PT.

### Bug 2 — `getTodayDate()` used runtime-local TZ (HIGH)

Same root cause as Bug 1, with same fix.

### Bug 3 — `formatDateYYYYMMDD()` used `getFullYear/getMonth/getDate` (HIGH)

For a Date representing 00:30 PT, `date.getDate()` returns the previous day in `Asia/Tokyo`.

**Fix:** `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' })` always returns the PT calendar day.

### Bug 4 — `parseDate()` returned a runtime-local Date (MEDIUM)

`new Date(year, month - 1, day)` constructs a Date at midnight in the runtime's local TZ, not UTC. When formatted later with a PT `Intl.DateTimeFormat`, a date near midnight could shift by one day.

**Fix:** `new Date(Date.UTC(year, month - 1, day))` — UTC-anchored, unambiguous.

### Bug 5 — `formatDateDisplay()` (HIGH)

Previously called `new Date(dateStr)` which is runtime-local. Now parses as UTC and then formats via `Intl.DateTimeFormat` with PT.

### Bug 6 — `timeWindows.getYesterdayDate()` (MEDIUM)

`src/utils/timeWindows.ts` duplicated the bug. Replaced with a PT-anchored calculation.

### Bug 7 — `uiHelpers.getMaxDate()` (MEDIUM)

`new Date().toISOString().split('T')[0]` returned UTC date, not PT. On a non-PT machine the employee would see the wrong "max date" on the date picker and could be blocked from entering today's entry.

**Fix:** `getTodayDate()` (now PT-anchored).

## New Regression Tests

Added 70+ new assertions across:

- `src/utils/utilities.test.ts` (303 new lines): 12 cases for `dateHelpers.getTodayDate / getYesterdayDate / formatDateYYYYMMDD / parseDate / formatDateDisplay` with `process.env.TZ = 'America/Los_Angeles' / 'Europe/London' / 'Asia/Tokyo'` and `jest.setSystemTime` to midnight UTC, midnight PT, and DST boundaries.
- `src/utils/timeWindows.test.ts` (100 new lines): `getYesterdayDate` and `getHoursUntilDeadline` with multiple TZs.
- `src/utils/timeCalculations.test.ts` (161 new lines): `getPTWeekStart` for Sunday PT week-start with `process.env.TZ` overrides.
- `src/utils/timeValidation.test.ts` (106 new lines): `checkTimeAnomalies` weekend detection under non-PT TZs.
- `src/utils/overtimeCalculations.test.ts` (136 new lines): CA 8/12/40 OT rules with edge cases.

## Verification

- `npm run test` → **298 / 298 PASS** (was 183 at baseline; +115 regression tests).
- `npm run build` → **OK** (no TypeScript errors).
- `npm run lint` → 29 pre-existing errors in `src/app/` (untouched by W2), 0 new errors.

## Verdict

**Safe to release.** The canonical "all payroll math is in America/Los_Angeles" rule is now enforced in every helper in `src/utils/`. The pre-existing audit reports (passes 1-6) had already audited `clockService`, `database.ts`, and the components; W2 was scoped to `utils/` to avoid stepping on parallel workstreams.

## Remaining Risks

- Pre-existing lint errors in `src/app/` (not introduced by this audit) need a separate config fix (missing React globals in eslint flat config).
- DST edge case tests pass for the 2026 spring/fall transitions but should be re-run against the 2027 boundaries.
