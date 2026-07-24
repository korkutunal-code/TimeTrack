# ESLint Warnings Cleanup — Pragmatic Zero

## Goal
Drive `npm run lint` from **315 warnings (0 errors)** to **0 warnings**, with real types in payroll-critical source code and targeted config relaxation for test mocks and shadcn/ui variant exports. **Zero runtime behavior change.**

## Baseline (measured 2026-07-24)

| Rule | Total | Source files | Test files |
|---|---|---|---|
| `@typescript-eslint/no-explicit-any` | 254 | ~140 | 114 |
| `@typescript-eslint/no-unused-vars` | 51 | ~46 | 5 |
| `react-refresh/only-export-components` | 5 | 5 (all in `src/app/components/ui/`) | 0 |
| `react-hooks/exhaustive-deps` | 3 | 3 | 0 |
| Unused eslint-disable directives | 2 | 2 (`HistoryView.tsx:133,136`) | 0 |

Worst source files: `src/app/lib/database.ts` (43), `src/app/components/employee/TodayEntry.tsx` (25), `src/services/clockService.ts` (17), `src/app/components/manager/TeamDashboard.tsx` (13), `src/app/components/admin/AdminTimesheetReview.tsx` (12), `src/app/components/admin/AdminPanel.tsx` (11).

## Decisions (agreed: "Pragmatic zero")
1. Fix all source-file warnings properly — no new suppressions in source.
2. Turn off `@typescript-eslint/no-explicit-any` for `**/*.test.{ts,tsx}` / `**/*.spec.*` in `eslint.config.mjs` (mocks legitimately need `any`). Keep `no-unused-vars` ON for tests; fix the ~5 remaining manually.
3. Fix the 5 `react-refresh` warnings via `allowExportNames` (standard shadcn/ui pattern) — do NOT split files.
4. The 3 `exhaustive-deps` warnings get per-case real fixes (add dep / `useCallback`); no blanket disables.

## Guardrails (AGENTS.md — non-negotiable)
- `database.ts`, `clockService.ts`, `segmentOps.ts`, `overtimeCalculations.ts`, `timeValidation.ts` are payroll-critical. **Type-only edits**: no logic, no `segments[]` shape, no Firestore structure changes → `firestore.rules` untouched, `test:rules` not required.
- No timezone math, audit-log, or soft-delete behavior may change. These edits are purely type-level; if any fix requires a runtime change, stop and flag it.
- Work in small batches; run `npm run test` after each batch.

## Fix recipes (source `any` patterns observed)
- `catch (e: any)` → `catch (e: unknown)` + narrow: `e instanceof Error ? e.message : String(e)` (apply same pattern everywhere; do not invent new error helpers).
- `const patch: any = { ... }` (Firestore `updateDoc` payloads) → `Record<string, unknown>`; use `Partial<TimeEntry>` where the shape is statically known.
- `snap.data() as any` → `as TimeEntry` / existing interfaces. `database.ts` already defines `TimeSegment`, `TimeEntry` — reuse them.
- `type FirestoreTimeEntry = any` (database.ts:103, used only by `mapEntry`) → `DocumentData` (already importable from `firebase/firestore`).
- `(x as any).toDate()` (e.g. `tsToMillis`, database.ts:109) → structural type `{ toDate(): Date }` or `Timestamp`.
- `let lastDoc: any = null` → `QueryDocumentSnapshot<DocumentData> | null`.
- `TimeEntry.lunch_reminder_sent_at / clockout_reminder_sent_at / longshift_reminder_sent_at: any` (database.ts:47-49) → `Timestamp | number` (both flow through existing `tsToMillis`).
- `(entry as any).taskId` (TodayEntry.tsx:308,468) → `TimeSegment` already has `taskId?: string`; add `taskId?: string` to `TimeEntry` only if entry-level usage requires it.

## Ordered task list

### Batch 1 — auto-fix + config (expect drop to ~195)
1. `npm run lint -- --fix` — removes the 2 unused eslint-disable directives in `HistoryView.tsx`.
2. `eslint.config.mjs`: in the existing test override block (files `**/*.test.{ts,tsx}`, `**/*.spec.{ts,tsx}`), add `'@typescript-eslint/no-explicit-any': 'off'`.
3. `eslint.config.mjs`: extend the react-refresh rule:
   `'react-refresh/only-export-components': ['warn', { allowConstantExport: true, allowExportNames: ['badgeVariants', 'buttonVariants', 'toggleVariants', 'navigationMenuTriggerStyle', 'useSidebar'] }]`
4. Run `npm run lint`; confirm only `no-explicit-any` (source), `no-unused-vars`, `exhaustive-deps` remain.

### Batch 2 — unused vars sweep (51)
5. Remove unused imports (e.g. `Card`, `Badge`, `Download`, `ManagerView`).
6. Unused catch bindings (`catch (error)` / `catch (e)` with no use) → optional catch binding `catch {`.
7. Dead locals (`setSearchTerm`, `parseTimeToMinutes`, `exportCSV`): inspect first — if they are half-wired features, remove the dead code only; do not "complete" features. Fix the ~5 unused vars in test files the same way.

### Batch 3 — exhaustive-deps (3, behavior-sensitive)
8. `src/app/App.tsx:129` (`currentUser`): audit effect; add dep if re-run on auth change is safe (expected yes).
9. `src/app/components/admin/AdminTimesheetReview.tsx:51` (`endDate`, `startDate`): adding deps causes refetch on date change — verify that is intended.
10. `src/app/components/manager/TeamDashboard.tsx:62` (`applyFilters`): wrap `applyFilters` in `useCallback`, then add to deps.
11. Manually smoke-check each affected screen (or note for manual QA). If a dep truly must be omitted, use a targeted `// eslint-disable-next-line react-hooks/exhaustive-deps` with a justification comment — needs explicit sign-off, not default.

### Batch 4 — type the payroll-critical core first (~90 any)
Order: `src/app/lib/database.ts` (43) → `src/services/clockService.ts` (17) → `src/services/auditLogService.ts` (7) → `src/services/authService.ts` (7) → `src/app/lib/segmentOps.ts` (4) → `src/app/lib/auth.ts` (3) → `src/app/lib/qaMode.ts` (1) → `src/utils/timeValidation.ts` (5) → `src/utils/overtimeCalculations.ts` (1) → `src/services/bulkImportService.ts` (1).
- Apply fix recipes above. One file per commit-sized step; `npm run test` after each file.

### Batch 5 — type the components (~50 any)
`TodayEntry.tsx` (25), `TeamDashboard.tsx` (13), `AdminTimesheetReview.tsx` (12), `AdminPanel.tsx` (11), `TimeAdjustmentModal.tsx` (7), `PayrollReports.tsx` (6), `ClockPunch.tsx` (4), `AuditViewer.tsx` (4), `ReportProblemButton.tsx` (4), `LoginPage.tsx` (3), `PatternMetrics.tsx` (3), `HistoryView.tsx` (3), `App.tsx` (3), `CorrectionRequests.tsx` (2), `ClockStatus.tsx` (2), plus the single `any` in each `ui/*` file not resolved by Batch 1.
- Mostly `catch (e: any)` → `unknown` + narrowing, and `payload: any` → `Record<string, unknown>`.

### Batch 6 — final verification
12. `npm run lint` → must report **0 problems**.
13. `npm run test` → all Jest suites green (payroll/overtime/segments coverage must pass unchanged).
14. `npm run build` → Vite build compiles (catches type regressions lint misses).

## Risks
- **exhaustive-deps fixes can change re-render/refetch timing** → Batch 3 requires manual screen verification.
- **Typing `snap.data()` may surface latent shape mismatches** (e.g. fields present in Firestore but missing from `TimeEntry`) → extend interfaces rather than casting back to `any`.
- **`Record<string, unknown>` vs `updateDoc`**: accepted by Firestore's `UpdateData<DocumentData>`; if a specific call site complains, use `Partial<TimeEntry>` at that site.

## Out of scope
- Typing test-file mocks beyond removing unused vars (rule relaxed by decision 2).
- Splitting shadcn/ui files.
- Any runtime/feature changes, Firestore schema or rules changes.

## Rollback
Each batch is independently revertable (type-only changes). If a payroll test fails after a batch, revert that batch's file and re-approach with a narrower type.
