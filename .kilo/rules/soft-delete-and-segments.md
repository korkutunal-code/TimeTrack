# TimeTrack Rule: Soft Deletes Only + Overtime Segment Integrity

**Applies to:** Any agent touching timeEntries, corrections, or payroll-related collections.

## Mandatory Rules
1. **Never hard delete.** Use `status: 'voided' | 'archived'` only.
2. **Segment model integrity.** All lunch breaks, split shifts, and multi-session days must continue to be represented in the `segments[]` array. Do not flatten or bypass the segment model.
3. **Overtime calculations** must continue to follow California rules exactly (see `overtimeCalculations.ts`).

## Verification Checklist
- [ ] No `.delete()` calls on time-related documents.
- [ ] Any new UI or service that changes time data still emits the correct segments and triggers audit + overtime recalculation.
- [ ] Existing payroll reports and exports remain accurate after the change.

**Reference:** AGENTS.md lines 36, 49 (segments), 38 (CA OT), overtimeCalculations.ts
