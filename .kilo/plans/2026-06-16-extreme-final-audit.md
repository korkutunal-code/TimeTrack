# Extreme Final Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Always load the `reviewer`, `planner`, `doc-agent`, and `payroll-guardian` personas from `.kilo/personas/` before starting work, and inject the three TimeTrack rule files under `.kilo/rules/`.

**Goal:** Perform an adversarial, evidence-based release audit of TimeTrack Phase 1, covering code, build, unit/rule tests, role-based E2E flows, data persistence after reload, deployment scripts, and cross-model compatibility. Produce a final report with GO / CONDITIONAL GO / NO-GO, severity-ranked findings, reproduction steps, root causes, fixes, tests added, and remaining risks.

**Architecture:** The audit is split into parallel, isolated workstreams (Code, Employee Flows, Manager/Admin Flows, Infrastructure/Scripts, Cross-Cutting/Edge Cases). Each workstream produces a findings artifact and, where required, failing regression tests + minimal fixes. A final integration pass reruns all verification and writes the release recommendation.

**Tech Stack:** React + Vite + Firebase (Auth/Firestore/Hosting), Tailwind v4, Jest, Playwright (Python), ESLint v9, `firebase emulators`, service-account `firebase-admin` scripts.

---

## 0 — Safety & Environment

**MANDATORY:** Never run destructive operations against real employee data. All cleanup, seeding, and live E2E must target a controlled environment using test accounts only.

| Decision | Resolution |
|---|---|
| Worktree | Create via Agent Manager (`audit/extreme-final-audit` branch) from current `main`. |
| Live E2E target | `https://atd-time-tracking.web.app` (production Firebase project `atd-time-tracking`). There is no committed staging project config (`.firebaserc` only declares `default: atd-time-tracking`, and `.env.staging.example` is an empty template with no active staging project reachable). E2E must therefore target the existing test accounts. |
| Allowlisted test accounts | `test@test.com` (employee), `admin@test.com` (admin), and `manager-audit@test.com` (manager; create with `scripts/create-live-test-user.mjs --role=manager --email=manager-audit@test.com --name "Audit Manager"` if it does not exist yet). No other emails may be seeded, voided, or edited. |
| Cleanup policy | Cleanup scripts already target a single email via `--user=` (`cleanup-test-data.mjs`) or void all docs for `test@test.com` (`myshift_live.py`). Audit will add an explicit allowlist guard to any new/modified script and default to `--dry-run` before any mutation. |
| Database inspection | Use a read-only service-account script (`scripts/verify-entry-state.mjs`); no `delete()` and no `FieldValue.delete()` against non-test documents. |

---

## 1 — Worktree Setup & Baseline

- [ ] **Step 1.1: Detect/create isolated worktree**
  - Use `superpowers:using-git-worktrees`.
  - Create branch `audit/extreme-final-audit` (worktree path `.worktrees/audit-extreme-final-audit` if project-local).
  - Verify the directory is git-ignored.
- [ ] **Step 1.2: Install dependencies and verify clean baseline**

  ```bash
  npm install
  ```
- [ ] **Step 1.3: Run existing verification suite and record results**

  ```bash
  npm run lint
  npm run test
  npm run build
  ```

  Record exact pass/fail counts in `docs/audits/audit-extreme-final-<date>.md`.
- [ ] **Step 1.4: Run Firestore rules tests**
  - Start emulator: `firebase emulators:start --only firestore`
  - In another shell: `npm run test:rules`
  - Record result.

---

## 2 — Code-Level Adversarial Audit (Static Analysis)

Assign to the `reviewer` persona + one `code` worker subagent per bullet area.

### 2.1 Security & Permission Model

- [ ] **Step 2.1.1: Audit Firestore rules against all UI capabilities**
  - Compare `firestore.rules` to every write path in `src/services/clockService.ts`, `src/app/lib/database.ts`, `src/services/auditLogService.ts`, and admin components.
  - File bug reproduction for any capability the UI exposes but rules forbid (e.g., manager updating a correction request in `CorrectionRequests.tsx` vs rules only allowing `admin` update).
  - Add missing rules tests in `scripts/test-firestore-rules.js` for any discovered gap.
- [ ] **Step 2.1.2: Verify no hard-delete paths**
  - Grep for `.delete()` calls outside of `scripts/` and user-deletion flows.
  - Confirm `timeEntries` are never hard-deleted; only `status` transitions to `voided`/`archived`.
- [ ] **Step 2.1.3: Verify audit immutability**
  - Confirm `auditLogs` rules deny update/delete and that UI never attempts to edit audit rows.
  - Add rules tests for manager/admin/employee/unauthenticated update/delete attempts.

### 2.2 Timezone & Date Math Enforcement

- [ ] **Step 2.2.1: Manual code inspection**
  - Review every usage of `new Date()`, `.toLocaleString`, `.getDay()`, `.getHours()` in `src/` for payroll-affecting logic.
  - Files of interest: `src/utils/timeValidation.ts`, `src/utils/timeCalculations.ts`, `src/utils/overtimeCalculations.ts`, `src/utils/dateHelpers.js`, `src/app/lib/database.ts`, `src/services/clockService.ts`.
- [ ] **Step 2.2.2: Add regression tests for any local-TZ usage found**
  - Use `jest.setSystemTime` with `America/Los_Angeles` offsets and non-PT timezones to prove the bug.
  - Example test scaffold:

  ```ts
  // src/utils/timeValidation.test.ts
  import { checkTimeAnomalies } from './timeValidation';

  describe('timezone safety', () => {
    it('does not treat a weekday as weekend when running in a different TZ', () => {
      // Set system TZ to UTC±offset and validate PT date 2026-06-15 (Mon)
      const result = checkTimeAnomalies(3, '17:00', '2026-06-15', { clockInManual: '08:00' });
      expect(result.hasAnomaly).toBe(false);
    });
  });
  ```

### 2.3 Segment Model & Legacy Compatibility

- [ ] **Step 2.3.1: Trace dual-write consistency**
  - For every write in `clockService.punchIn`, `clockService.punchOut`, `clockService.toggleLunch`, confirm that legacy top-level fields and `segments[]` remain consistent after a round-trip through `mapEntry`.
  - Check fields: `clockInManual`, `clockOutManual`, `lunchOutManual`, `lunchInManual`, `complete`, `dayComplete`, `totalWorkMinutes`, `status`.
- [ ] **Step 2.3.2: Verify `getActiveSegment` handles all document shapes**
  - Test scenarios: no doc, legacy doc with only top-level fields, doc with `segments[]`, voided doc with open segment, archived doc, doc with multiple segments, doc with stale `${id}_current` duplicates.
  - Add tests to `src/app/lib/database.test.ts`.
- [ ] **Step 2.3.3: Verify segment idempotency and no infinite array growth**
  - Repeated punch-out/lunch toggles must not add duplicate segments or grow `segments[]` indefinitely.

### 2.4 Unhandled Promise & Console Error Audit

- [ ] **Step 2.4.1: Find unhandled async paths**
  - Grep for `.then(`/`.catch(` patterns and `async` functions without try/catch in event handlers.
  - Components to inspect: `ClockPunch.tsx`, `TodayEntry.tsx`, `AdminPanel.tsx`, `CorrectionRequests.tsx`, `PayrollReports.tsx`.
- [ ] **Step 2.4.2: Record any new uncaught paths as test cases**
  - A new E2E must fail if a console error or `pageerror` event fires.

---

## 3 — Automated Verification Expansion

### 3.1 Unit / Integration Tests

For each area, write the failing test first (TDD) where the audit exposes a gap.

- [ ] **Step 3.1.1: Manager-specific correction-request permission tests**
  - `CorrectionRequests.tsx` lets managers view all requests and update status, but `firestore.rules` only allows admins to update. Add failing rule test && decide whether to lower rules to manager or tighten UI.
- [ ] **Step 3.1.2: Duplicate / rapid-click protection**
  - `clockService.punchIn` uses `runTransaction` but `ClockPunch.tsx` disables the button only via `actionLoading`. Test behavior when two `punchIn` calls race before the first returns.
  - Add a unit test mocking two simultaneous transactions against the same doc.
- [ ] **Step 3.1.3: Offline / interrupted write behavior**
  - If Firestore goes offline mid-punch, does the UI show stale state or retry? Add a controlled `goOffline()`/`goOnline()` test or mark as manual-only risk.
- [ ] **Step 3.1.4: Cross-day boundary (midnight PT)**
  - Mock system time at 23:59 PT, punch in, advance to 00:01 PT, verify a new `workDate` document is created.
  - `getCurrentPTDate()` must drive the new date; test with `jest.setSystemTime`.
- [ ] **Step 3.1.5: Audit reason mandatory on all correction paths**
  - Ensure admin correction/void flows call `auditLogService.logTimeCorrection()` / `logVoidEntry()` with non-empty reason.
  - Find any UI path that edits `timeEntries` without an audit log (e.g., `AdminPanel.tsx`, `AdminTimesheetReview.tsx`).

### 3.2 Build, Type, Lint Safety

- [ ] **Step 3.2.1: Full build + TypeScript check**

  ```bash
  npm run build
  npx tsc --noEmit
  ```

  Record exact error count (must be 0 at release).
- [ ] **Step 3.2.2: Lint with zero errors**

  ```bash
  npm run lint
  ```

  Do not suppress new warnings without a comment justification.

---

## 4 — Role-Based E2E Flow Adversarial Testing (Playwright)

Target URL must be configurable via `BASE_URL` env var; default to production only if explicitly approved.

### 4.1 Employee Flows (`test-artifacts/myshift_live.py` extensions)

- [ ] **Step 4.1.1: Reproduce prior UI-flip failure**
  - Run the existing `(A) CLOCKPUNCH` and `(B) CLASSIC` flows and confirm green after a fresh reload of the app for each state.
  - Capture screenshots and `timeEntries` document state after every button click, then verify persisted document after hard page reload.
- [ ] **Step 4.1.2: Duplicate-click adversarial**
  - Click `CLOCK IN` twice in rapid succession, validate only one open segment is created and the second click shows a toast error (not two documents).
- [ ] **Step 4.1.3: Refresh / navigation adversarial**
  - After `START LUNCH`, hard-refresh the page and confirm the UI shows `END LUNCH` with the same segment.
  - Navigate to History and back; confirm state is preserved.
- [ ] **Step 4.1.4: Logout/login adversarial**
  - Clock in, sign out, sign in as the same user, confirm the open segment is still active.
- [ ] **Step 4.1.5: Split-shift scenario**
  - Clock in, clock out, clock in again on the same PT day. Confirm `segments[]` contains two segments and `totalWorkMinutes` sums both.
  - Verify the UI shows `CLOCK OUT` for the second open segment.
- [ ] **Step 4.1.6: Offline toggle**
  - Use Playwright's `context.setOffline(true)` immediately after clicking `CLOCK IN`. Confirm the UI handles the failure gracefully (toast, no phantom state) and that a subsequent online reload is consistent.

### 4.2 Manager Flows

- [ ] **Step 4.2.1: Create/provision a manager test account**
  - Use `scripts/create-live-test-user.mjs --role manager --name "Audit Manager"` or add manually to the Firebase project.
- [ ] **Step 4.2.2: Smoke manager view**
  - Log in as manager, verify `Team` and `My Time` tabs load, no console errors.
- [ ] **Step 4.2.3: Manager correction-request behavior**
  - As an employee, create a correction request.
  - As a manager, open `Corrections` tab, click `Update`, attempt to change status.
  - Verify whether Firestore rules reject the write and how the UI surfaces the error.
  - Record finding and fix rules or UI.

### 4.3 Admin Flows

- [ ] **Step 4.3.1: Admin smoke pass**
  - Run `test-artifacts/inspect_live.py` and confirm admin all 6 tabs still load.
- [ ] **Step 4.3.2: Admin correction with audit trail**
  - From the Admin panel or correction request flow, edit a `timeEntries` document and provide a reason.
  - Verify an `auditLogs` document is written with the exact reason, non-empty before/after, and correct `targetId`.
  - Verify the audit log is immutable (attempt update/delete via service account and confirm rules deny).
- [ ] **Step 4.3.3: Admin void entry**
  - Void a test `timeEntries` doc through the UI with a reason.
  - Confirm `status: 'voided'`, no hard delete, and `auditLogs` entry created.
  - Confirm the employee can then punch in fresh on the same day.

---

## 5 — Database Persistence Verification

**Do not trust the UI or toasts.** After each critical flow, query Firestore directly and compare with UI state.

- [ ] **Step 5.1: Create a read-only verification script**
  - File: `scripts/verify-entry-state.mjs`
  - Accepts `--email`, `--date` (defaults to PT today), prints the raw `timeEntries/<uid>_<date>` document and the `mapEntry()`-hydrated view.
- [ ] **Step 5.2: Run after every E2E write**
  - After clock-in, lunch start/end, clock-out, admin edit, void.
  - Validate fields match:
    - `segments[]` length and `complete` flags
    - legacy top-level fields
    - `totalWorkMinutes`
    - `status`
    - `auditLogs` existence for corrections/voids
- [ ] **Step 5.3: Stale-data test**
  - Open the app in two tabs/browsers as the same employee. Clock in on tab A. On tab B, wait for the 60s auto-refresh or click Refresh. Confirm both tabs show the same state and the Firestore document has exactly one open segment.

---

## 6 — Infrastructure, Scripts & Deployment Safety

Assign to a `build/infra` worker + `reviewer` persona.

- [ ] **Step 6.1: Review all scripts in `scripts/` for destructive operations**
  - `cleanup-test-data.mjs`, `delete-test-users.mjs`, `seed-*.mjs`, `verify-import-logic.mjs`, `deploy.sh`.
  - Confirm each script either targets test users only or has a `--dry-run` flag.
  - Add guard in `cleanup-test-data.mjs` to abort if run against a non-test account (match email domain or explicit `--force-prod` flag).
- [ ] **Step 6.2: Verify `deploy.sh` does not deploy to production by accident**
  - Ensure the script specifies `--project` explicitly or fails if `firebase use` is not staging.
  - Add a confirmation prompt / `--confirm` flag if not present.
- [ ] **Step 6.3: Seed script safety**
  - `npm run seed:test-users` must not overwrite existing production user profiles without confirmation.
  - Add idempotency check and a pre-seed test-account allowlist.
- [ ] **Step 6.4: CI workflow review**
  - Read `.github/workflows/ci.yml` and verify lint/test/build are all gated and no destructive Firebase scripts run in CI.

---

## 7 — Edge Cases & Stress Tests

- [ ] **Step 7.1: Timezone boundary**
  - Set CI / local machine TZ to `Europe/London`, run jest tests that depend on PT date, ensure they still pass.
- [ ] **Step 7.2: Incomplete legacy documents**
  - Seed a doc with only `clockInManual` and no `segments[]`, no `currentStep`. Confirm ClockPunch sees an open shift and allows clock-out without data loss.
- [ ] **Step 7.3: Multiple open segments anomaly**
  - Seed a document with two `complete: false` segments in `segments[]`. Confirm validation rejects clock-in and UI surfaces an actionable error.
- [ ] **Step 7.4: Large `segments[]` / pagination**
  - Use `seed-historical-data.mjs` to create 100+ entries and verify admin payroll/metrics tabs still load without timeout or memory blowup.

---

## 8 — Fix, Test, Verify Cycle

For each finding:

- [ ] **Step 8.1: Reproduce in a minimal test** (unit, rule, or E2E). Commit the failing test.
- [ ] **Step 8.2: Apply minimal root-cause fix.** No fallback patches. Avoid broad refactors.
- [ ] **Step 8.3: Rerun related tests + full verification suite.**

  ```bash
  npm run lint
  npm run test
  npm run build
  npx tsc --noEmit
  npm run test:rules  # if rules touched
  ```
- [ ] **Step 8.4: Rerun E2E flows that touch the changed code path.**
- [ ] **Step 8.5: Document in the running audit report.**

---

## 9 — Final Integration & Release Report

- [ ] **Step 9.1: Aggregate findings from all workstreams into `docs/audits/audit-2026-06-16-final.md`.**
- [ ] **Step 9.2: Final verification run**
  - Exact commands:

    ```bash
    npm run lint
    npm run test
    npm run build
    npx tsc --noEmit
    ```
  - Emulator rules test:

    ```bash
    firebase emulators:start --only firestore
    npm run test:rules
    ```
  - Live E2E (employee + manager + admin):

    ```bash
    cd test-artifacts
    python myshift_live.py
    python inspect_live.py
    python flow_live.py
    ```
- [ ] **Step 9.3: Produce final report with the required sections:**
  1. Executive summary and release recommendation (`GO` / `CONDITIONAL GO` / `NO-GO`).
  2. Every issue found, severity (`Critical` / `High` / `Medium` / `Low`).
  3. Exact reproduction steps.
  4. Root cause.
  5. Files and code paths affected.
  6. Fix applied or recommended.
  7. Tests added and evidence the fix works.
  8. Remaining risks, technical debt, and anything not fully verified.
  9. Final totals: unit tests, build checks, E2E tests, browser errors, failed workflows.
- [ ] **Step 9.4: Update `docs/phase1-final-readiness/`**
  - Append a brief note to `PHASE1_ROLLOUT_CHECKLIST.md` or create `PHASE1_FINAL_AUDIT_SIGNOFF.md`.
- [ ] **Step 9.5: Merge / handoff**
  - Do **not** merge to `main` without explicit user approval in a follow-up session.
  - Leave the `audit/extreme-final-audit` branch clean with logical commits.

---

## 10 — Parallel Subagent Dispatch Plan

Use `superpowers:subagent-driven-development`: one manager/coordinator agent per checkpoint plus one worker agent per independent workstream below. Each worker returns findings.json + branch commits. The coordinator merges, resolves conflicts, and runs final verification.

| Workstream | Worker agent focus | Key files to inspect/modify | Required personas/skills |
|---|---|---|---|
| **W1 — Security & Rules** | Compare all write paths to `firestore.rules`; add missing rule tests; fix rule/UI mismatches. | `firestore.rules`, `scripts/test-firestore-rules.js`, `src/app/components/admin/CorrectionRequests.tsx`, `src/services/auditLogService.ts`, admin components. | `reviewer`, `code`, `verification-before-completion` |
| **W2 — Timezone & Payroll Math** | Search for unguarded `new Date()` usage in payroll paths; add TZ-invariant regression tests. | `src/utils/timeValidation.ts`, `src/utils/timeCalculations.ts`, `src/utils/overtimeCalculations.ts`, `src/utils/dateHelpers.js`, `src/utils/scheduleHelpers.js`, `src/services/clockService.ts`. | `payroll-guardian`, `test-driven-development`, `timezone-enforcement` rule |
| **W3 — Employee Clock Flows** | Extend Playwright employee E2E: duplicate clicks, refresh/logout, split shift, offline, DB cross-check. | `src/app/components/employee/ClockPunch.tsx`, `test-artifacts/myshift_live.py`, `scripts/verify-entry-state.mjs` (new), `src/app/lib/database.ts`. | `webapp-testing`, `code`, `soft-delete-and-segments` rule |
| **W4 — Manager & Admin Flows** | Provision manager test account; test manager correction permissions; test admin correction audit trail and void. | `src/app/components/manager/TeamDashboard.tsx`, `src/app/components/admin/*`, `src/services/auditLogService.ts`, `test-artifacts/inspect_live.py`, `test-artifacts/flow_live.py`. | `reviewer`, `admin`, `audit-mandatory-reason` rule |
| **W5 — Scripts & Deployment Safety** | Review every script in `scripts/` for destructive operations, add allowlist/dry-run guards, review CI workflow. | `scripts/deploy.sh`, `scripts/cleanup-test-data.mjs`, `scripts/create-live-test-user.mjs`, `scripts/seed-*.mjs`, `scripts/delete-test-users.mjs`, `.github/workflows/ci.yml`. | `build/infra`, `reviewer` |
| **W6 — Cross-Cutting Edge Cases** | Stress test: timezone boundary, legacy doc shapes, multiple open segments, large datasets, build/type/lint zero errors. | Multiple across `src/`; `seed-historical-data.mjs`; CI environment. | `code`, `verification-before-completion` |

**Coordinator checkpoints:**

1. After W1–W6 have each committed their failing tests / found findings, the coordinator runs `npm run lint; npm run test; npm run build` to establish the broken baseline.
2. After fixes are applied, the coordinator reruns the full verification matrix and rolls back any incomplete fixes.
3. Before final report, the coordinator runs live E2E for all three roles, collects results, and merges everything into `docs/audits/audit-2026-06-16-final.md`.

---

## Known Suspicions to Investigate First

These are starting points, not conclusions. Each must be verified or disproved.

1. **Manager correction-request update mismatch:** `CorrectionRequests.tsx` allows managers to update request status; `firestore.rules` line 88 restricts update to `admin` only. Either the UI will fail for managers or rules need adjustment.
2. **Admin correction/void audit trail gaps:** Any admin edit of `timeEntries` outside `CorrectionRequests.tsx` or `AdminPanel.tsx` may bypass `auditLogService`. Verify with code search for `updateTimeEntry`, `updateDoc(timeEntries`, `setDoc(timeEntries` in `src/`.
3. **`getPunchStatus.todayTotalMinutes` live estimate ignores lunch:** An open segment's live estimate subtracts nothing if the employee is on lunch. Confirm whether this is acceptable for the employee UI or should be fixed.
4. **`getWeekSummary.weekEnd` is always today:** The comment says "7-day window" but `weekEnd` equals `ptDate`. Historical days after today are never included, which is fine, but weekend display may be misleading.
5. **Offline banner promises "saved when connection restored" but there is no visible offline queue/optimistic-write handling.** Investigate whether Firestore persistence is enabled and whether failed writes silently drop state.
6. **`createInitialSegment` uses `Date.now()` on the client** for segment id but compares/uses server `Timestamp.now()` for `clockInSystem`. The segment id is only locally stable; make sure no logic depends on id ordering across devices.

---

## 11 — Execution Handoff

**Decisions resolved:**

- Live E2E will run against **`https://atd-time-tracking.web.app`** because no staging Firebase project is currently reachable from committed project configuration.
- Test-data mutation is allowed **only** for the allowlisted accounts: `test@test.com`, `admin@test.com`, and `manager-audit@test.com` (created via `scripts/create-live-test-user.mjs` if missing).
- Execution model: **parallel subagent-driven**, per Section 10.

**Launch instruction:**

Dispatch worker agents for workstreams W1–W6 in parallel. Each worker must:

1. Operate in the `audit/extreme-final-audit` worktree.
2. Load the `reviewer`, `planner`, `doc-agent`, and `payroll-guardian` personas and the three `.kilo/rules/` files.
3. Follow the `verification-before-completion` skill for every claim.
4. Return a `{workstream}-findings.md` artifact and a commit hash.

Run the final integration pass and report only when all workstreams are complete and the full verification matrix has passed, or failing results are clearly documented.  Do not merge to `main` without explicit user approval in a follow-up session.
