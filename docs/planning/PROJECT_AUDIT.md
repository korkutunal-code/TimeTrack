# PROJECT_AUDIT.md — TimeTrack Current-State Assessment (Audit Agent)

**Agent**: Audit Agent (isolated worktree: `audit/current-app-review`)  
**Date**: 2026-05-25  
**Scope**: Read-only review of https://github.com/torosasik/TimeTrack to establish baseline before any multi-agent design or feature work.  
**Output Constraint (First Run)**: No source code, configuration, or security rule modifications performed. Zero risk to production.

---

## 1. Executive Summary

The repository is a functional, production-deployed internal employee time-tracking SPA (currently hosted at `time.americantiledepot.com` per docs).

Strengths:
- Solid role-based foundation (employee / manager / admin) backed by Firebase Auth + Firestore user profiles + explicit rules.
- Mature anti-cheat / sequential workflow logic plus split-shift segment model.
- California-specific overtime engine already implemented.
- Rich operational documentation (ONBOARDING, WEEK1, TIME_INTEGRITY PLAN, TESTING GUIDE, FINAL_CHECKLIST).
- CSV payroll export path exists and is used in Admin Payroll Reports.

Gaps (critical for “real operations” launch):
- Still uses manual step-wise time entry; true punch-clock UI does not exist.
- Admin correction paths do **not** universally enforce a mandatory human reason (audit integrity risk).
- **No dedicated immutable audit log collection**. Changes to `timeEntries` leave only sparse `correctionNotes`.
- Hard-coded Firebase web keys present in committed source (security smell).
- No modeling yet for vacations, sick leave, public holidays, work-week config, expected hours.
- Timezone handling is partially per-user (stored in profiles) but business rules and calculations largely assume browser local time; **America/Los_Angeles mandate not yet systemic**.
- Admin surface area is high-risk because there is no separate audit trail for corrections.
- Testing coverage appears thin (Jest present but few snapshot or rule tests exercised in CI evidence).

**Readiness verdict**: "Mostly working" for pilot / small-team use but **not yet safe** for company-wide mandatory daily clocking without the planned Phase 1 scaffolding.

---

## 2. Technology Stack (As-Observed)

| Layer | Technology | Notes & Versioning |
|-------|------------|--------------------|
| Frontend Framework | React 18.3 + TypeScript 5.7 + Vite 6 | Modern SPA |
| UI Library | Radix UI (via shadcn-style wrappers), Tailwind 4.1, Lucide icons, date-fns 3, recharts, `@mui/icons-material` (some drift) | Component library is extensive; inconsistent icon system (mui + lucide) |
| State / Data | Firebase SDK 10.7 (Auth + Firestore) | No Redux / Zustand / React Query wrapper — direct service calls |
| Build / Tooling | Vite + PostCSS + Tailwind plugin; Jest + ts-jest | No visible ESLint config at audit time (needs verification); TypeScript strictness unknown |
| Emulators | Firebase emulators wired locally via VITE_USE_EMULATORS or ?emu flag | Good for development/security testing |
| Hosting | Firebase Hosting (firebase.json) with SPA fallback + cache-busting headers | Production domain separate; note `public` points to `build_output` |
| Functions | Declared but **functions/** directory does not exist in repo (empty stub only) | Future-proofing placeholder |

SDK drift note: Minor mixing of MUI icons alongside lucide-react creates bundle waste; not critical.

---

## 3. Firebase / Google Cloud Footprint

**Project ID**: `atd-time-tracking`  
**Auth Domain**: `atd-time-tracking.firebaseapp.com`

### 3.1 Configuration Exposure (Critical Risk)
File: `src/config/firebase.config.js`
```js
export const firebaseConfig = {
  apiKey: "AIzaSyC_6fkVeub7ZJp4yzSAIp6yZEsrhRk5lQI",
  authDomain: "atd-time-tracking.firebaseapp.com",
  projectId: "atd-time-tracking",
  ...
};
```
- API key committed in plain text in repository.
- Only safe for client-side because it is publishable, but still best practice to rotate / document exposure.
- `APP_DOMAIN` placeholder present; `APP_URL` computed but unused in code.

### 3.2 Auth
- Email/password + Google OAuth supported (see `src/app/lib/auth.ts:39-105`).
- Profile load always hits Firestore `users/{uid}`; absence → treated as "not onboarded".
- `sms_opt_in`, `work_email`, `phone_number`, `timezone` optional profile fields.
- No self-service registration page exposed in main UI (register method exists in service but gated).

### 3.3 Firestore
**Current collections observed**:
- `users`
- `timeEntries` (primary business collection — heavy use of `workDate`, `userId` composite queries)
- `correctionRequests` (employee-initiated change requests)
- `systemSettings/payroll` (payroll lock metadata only)

**Indexes** (`firestore.indexes.json`):
- `timeEntries`: `(userId ASC, workDate DESC)`
- `correctionRequests`: `(employee_id ASC, created_at DESC)`

**Rules** (`firestore.rules`, 101 lines, version 2):

**Strong Aspects**:
- Users may create only their own employee profile with role=`employee` (prevents self-escalation).
- `timeEntries` list is hard-filtered by `userId == request.auth.uid`.
- Admin-only user update/delete.
- Admin-only collection delete for time entries.

**Weaknesses / Gaps**:
- No `auditLogs` collection rules yet (no dedicated audit trail).
- Correction request update path only protected by `hasRole('admin')`; no signature that the resolution reason is mandatory in rules layer.
- No rules enforcing immutable original time values on correction (by design — history is kept via app-level duplicate fields in requests, not by snapshots of the original entry).
- `systemSettings/payroll` is readable by **all authenticated users** (intentional for lock date propagation); write limited to admin. Low risk but worth documenting.

---

## 4. Application Structure & Key Entry Points

**Root**: `src/main.tsx` → `src/app/App.tsx` (central role-based router via tabs + conditional component trees).

**Major Component Families**:

| Role/Views | Components | File Paths | Status |
|------------|------------|------------|--------|
| Login | LoginPage | `src/app/components/LoginPage.tsx` | Basic; supports password reset + Google |
| Employee | TodayEntry (multi-step 0-4), HistoryView | `TodayEntry.tsx` (~1235 LOC), `HistoryView.tsx` | Mature; sequential lock, yesterday blocker, validation |
| Manager | TeamDashboard (team view + own time tabs) | `TeamDashboard.tsx` | Read-only team view + filters + CSV export |
| Admin | AdminPanel, PayrollReports, AuditViewer, PatternMetrics, CorrectionRequests | Various under `admin/` | Very capable; wide surface |
| Shared UI | ~50 shadcn/Radix components under `ui/` | Heavy reuse | Good, duplicated MUI icon usage noted |

**Service Layer** (under `src/app/lib/` and `src/services/`):
- `auth.ts` — central role profile loader.
- `database.ts` (~504 LOC) — heavy mapEntry + segment reconstruction + CRUD wrappers.
- `exportService.ts` — pure CSV generation + browser download.
- `bulkImportService.ts` + test.
- `authService.ts` (root level) — legacy user provisioning helpers.
- `dragmeService.ts` — optional external task integration (Dragme).
- Various utility modules: `timeWindows.ts`, `timeValidation.ts`, `timeCalculations.ts`, `overtimeCalculations.ts`.

---

## 5. Authentication & Authorization Detailed View

**State Model** (from auth.ts + database.ts):
```ts
interface User {
  uid, email, name, role: 'employee'|'manager'|'admin', active: boolean,
  work_email?, phone_number?, sms_opt_in?, timezone?
}
```

**Flow**:
- onAuthStateChanged → loadUserProfile from Firestore.
- Inactive profile → immediate signOut + null return.
- First-time Google login auto-provisions as employee (graceful).

**Role Enforcement**:
- UI-level (App.tsx conditional render).
- Firestore rules (primary source of truth).
- Legacy permission util exists (`src/utils/permissions.js`) — lightly used; possibly duplication of rule intent.

**Observation**: No server-side callable functions enforce actions, so rules + client are the entire security boundary.

---

## 6. Time Entry & Calculation Logic (Deep Review)

**Segment Model** (innovative & solid):
- Legacy single flat entry (clock/lunch/clockout) is still supported via hydration.
- Modern `timeEntries/{uid_yyyy-mm-dd}` documents now contain:
  - Top-level legacy fields (for migration) AND
  - `segments[]` array (archived complete segments) + currently in-progress segment.
- `getActiveSegment`, `hasOpenSegment` helpers exist.
- Watchdog auto-closes long open segments (`autoClosed` flag).

**Validation** (`timeValidation.ts` + TodayEntry.tsx):
- Full sequential guardrails (clockIn → lunchOut → lunchIn → clockOut).
- Lunch warnings: <30 min or >60 min (UI flags + stored in entry).
- Yesterday blocker + time window enforcement (`timeWindows.ts`).
- Anomaly bypass flag (user acknowledged).

**Overtime** (`overtimeCalculations.ts`):
- Daily OT (8h @1.5×, 12h @2×) + Weekly (40h) implemented.
- Stores `regularMinutes`, `otMinutes`, `doubleTimeMinutes` at write time.
- Workweek start day is configurable in theory (default Sunday) but UI for changing it appears incomplete.

**Duplicate flags / short lunch** computed on read in `database.ts:261` — slight drift from strict "store-only" rule; acceptable but worth tightening.

**Correction Path**:
- Employee can create `correctionRequests`.
- Admin resolves via CorrectionRequests.tsx + AdminPanel correction flow.
- No **mandatory reason field** guard in all UI paths (multiple TODO-like manual notes required).
- Actual change is written to `timeEntries` via `updateTimeEntry()` (patch model) + optional `adminNotes` / `correctionNotes`.
- No immutable before/after snapshot or delta log row is created server-side.

**Risk**: Auditability depends on humans writing notes in the sparse `correctionNotes` field. Not legally defensible at scale.

---

## 7. Reporting & Export

**PayrollReports.tsx** + `exportService.ts`:
- Generates compliance CSV with regular/OT/double hours, lunch warnings, admin notes.
- Uses `dbService.getAllTimeEntries()` capped at 500 (index scan).

**PatternMetrics.tsx** / **AuditViewer.tsx**:
- Admin pattern detection + full time entry audit log viewer (reads raw entries for edits via notes).
- Valuable but oracle-dependent.

No server-side materialized payroll views; everything computed client-side from raw docs.

---

## 8. Gaps vs. Required HR Capabilities (OrangeHRM / Kimai Reference)

Missing or minimal:
- **Punch clock UI** — requested Phase 1.
- **Vacation / sick / unpaid balances** — no collection schema.
- **Public holidays** calendar (only implicit human holiday skip?).
- **Expected/working hours per employee type** + work week editing (overtime defaults exist, no per-worker policy UI).
- **Timesheet approval workflow** (beyond raw correction).
- **Payroll lock + export scheduler** — lock exists; automation absent.
- **Mobile-first true punch** (responsive claim but step form is desktop-heavy).

---

## 9. Operational & Documentation Maturity

Excellent:
- ONBOARDING_RUNBOOK.md + WEEK1_OPERATIONS.md describe real production use.
- TIME_INTEGRITY_PLAN.md (357 LOC) shows prior disciplined anti-cheat thinking.
- TESTING_GUIDE.md + FINAL_CHECKLIST.md exist.
- docs/deployment/, docs/operations/, docs/guides/ contain actionable runbooks.

Missing / thin:
- No visible CI (GitHub Actions?)
- Sparse Jest coverage (bulkImportService has a test, others are manual).
- No automated Firestore rule unit tests actively maintained (script `test-firestore-rules.js` stub exists but manual).
- Upgrade/migration plan for `segments[]` rollout not fully written.
- DR (disaster recovery / Firestore backup) omitted.

---

## 10. Security & Compliance Findings (Pre-QA Agent)

| Area | Finding | Severity | Recommendation |
|------|---------|----------|----------------|
| Firebase web keys | Committed in repo | Medium (public keys) | Document rotation + .env example for local overrides |
| Hard deletes | Only admin delete; no soft-delete status field yet | Medium | Enforce `status` enum on all writes |
| Correction audit trail | Absent as immutable collection | **Critical** | Introduce `auditLogs` + rules before Phase 1 |
| Role escalation | Well guarded at profile creation | Low | Excellent |
| Timezone | Inconsistent use of `user.timezone` vs. browser vs. PST assumptions | High | Standardize America/Los_Angeles in Phase 1 clock + calculations |
| Admin correction reason enforcement | UI-dependent, not rule- or service-enforced uniformly | High | Mandatory field + server guard in correction path |

---

## 11. Duplicate / Legacy Surface

- `permissions.js` (root utils) vs. role checks in `auth.ts` + UI — drift.
- Legacy provisioning helpers in old `authService.ts` vs. newer AdminPanel + `dbService`.
- Dragme integration code is optional but exists inside core TodayEntry path (can become dead weight if abandoned).

---

## 12. Files & Artifacts Examined (Representative Sample)

- `src/app/App.tsx`
- `src/app/lib/{auth, database, firebase}.ts`
- `src/app/components/employee/{TodayEntry, HistoryView}.tsx`
- `src/app/components/admin/{AdminPanel, PayrollReports, AuditViewer, ...}.tsx`
- `src/app/components/manager/TeamDashboard.tsx`
- `src/config/firebase.config.js`
- `firestore.rules`, `firestore.indexes.json`, `firebase.json`
- `package.json`
- Entire `docs/` tree (ONBOARDING, TIME_INTEGRITY_PLAN, TESTING_GUIDE, deployment & operations guides, multiple session summaries)
- `src/utils/{timeValidation, timeCalculations, overtimeCalculations, timeWindows, permissions}.ts|js`
- `src/services/exportService.ts` + bulkImport

**Total unique files read during audit**: 35+ (ongoing scan during session).

---

## 13. Conclusion & Hand-off to Architecture Agent

The existing TimeTrack app provides a **strong foundation** for employee attendance tracking with anti-fraud measures and CA-compliant payroll math already solved.

**Priority architectural decisions** to resolve before Clock/Admin Phase 1:
1. Introduce `auditLogs` collection with immutable before/after + actor + reason.
2. Enforce mandatory correction reason at the service layer.
3. Define clear status fields (`active|corrected|voided|archived`) and migration path.
4. Standardize `America/Los_Angeles` as company default + document per-user override handling.
5. Formalize punch segment state machine for future true clock UI.
6. Produce first-pass data model for leave/holidays to avoid rework later.

**No production mutations** performed by this audit run.

---

**Audit Agent Sign-off**: Ready for Architecture Agent to begin design docs. All observations referenced against real code and docs paths.

Next human gate: Review this file + proceed to Architecture phase.
