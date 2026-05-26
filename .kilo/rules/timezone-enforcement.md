# TimeTrack Rule: Timezone Enforcement

**Applies to:** All agents working on time entry, reporting, payroll, or date calculations.

## Mandatory Rule
- The canonical timezone for **all** payroll math, storage, daily/weekly cutoffs, and reports is `America/Los_Angeles` (PT/PST/PDT).
- Never use the browser's `Date` object or `new Date()` directly for any value that affects pay.
- All conversions must go through helpers in `src/utils/dateHelpers.js` (or equivalent `Intl.DateTimeFormat` with explicit timeZone: 'America/Los_Angeles').

## Verification Checklist (every agent must confirm)
- [ ] Any date used for overtime, daily total, or report is converted via the Pacific helper.
- [ ] No assumption that "today" == server/browser local date.
- [ ] Tests that touch dates explicitly set Pacific time or use the helper.

**Reference:** AGENTS.md lines 34, 46 (dateHelpers.js)
