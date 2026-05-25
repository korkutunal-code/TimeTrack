# WORKTREE_ASSIGNMENTS.md — File & Ownership Matrix

**Purpose**: Prevent overlapping edits across agents. Manager is the single source of truth. Every agent prompt MUST reference and follow this matrix.

**First Run Note**: All assignments below are read-only expectations for planning/audit/build-up docs phases. No agent may modify source tree (`src/`, `scripts/`, config). Only agents explicitly approved for Phase 1 may mutate "Allowed Write" areas, and only inside their isolated worktree.

---

## 1. Core Phase-0 Planning / Docs (All Read-Only)

| Worktree & Agent | Allowed Actions | Write Allowed? | Deliverables (relative) |
|------------------|-----------------|----------------|-------------------------|
| planning/hr-time-manager (Manager) | Create/maintain planning docs only. Read entire repo for context. | Only docs in own worktree root or docs/ | PROJECT_AGENT_PLAN.md, WORKTREE_ASSIGNMENTS.md, MERGE_ORDER.md |
| audit/current-app-review (Audit) | Full READ across repo to produce assessment. | Only PROJECT_AUDIT.md | PROJECT_AUDIT.md |
| architecture/hr-time-structure (Architecture) | Full READ. Design documents only. | Only the three specified design docs | ARCHITECTURE_PLAN.md, FIRESTORE_DATA_MODEL.md, SECURITY_RULES_PLAN.md |
| qa/testing-security (QA/Security) | Full READ + log review. | Only the three checklist/docs | QA_SECURITY_REVIEW.md, TESTING_CHECKLIST.md, LAUNCH_CHECKLIST.md |
| feature/leave-holidays (HR) (Phase-0) | Prep-only. May read. May produce plan doc. | Only HR_LEAVE_HOLIDAY_PLAN.md until code phase unlocked | HR_LEAVE_HOLIDAY_PLAN.md |

Agent-Specific Additional Rules:
- Audit & Architecture read everything but MUST NOT create branches in source or mutate rules while in planning phase.
- Any attempt to touch `src/`, `firestore.rules`, `firebase.json`, `package.json`, `tsconfig*` must be blocked.

---

## 2. Phase 1 Feature Work Ownership (Activated Post-Gate Only)

### 2.1 Clock Agent — `feature/punch-clock`
**Core Mission**: Build real punch-in/punch-out flow. Replace or supplement manual step form with simple mobile-friendly one-tap/two-tap UX for employees.

**Canonical Allow Globs (editable once cleared by manager gate)**:
- `src/app/components/employee/ClockPunch.tsx` (new)
- `src/app/components/employee/ClockStatus.tsx` (new or extensions)
- Updates to `src/app/components/employee/TodayEntry.tsx` **only** with explicit Manager one-time approval; otherwise forbid
- `src/utils/timeValidation.ts` (punch rules subset; clock-specific)
- `src/app/lib/database.ts` (minimal extensions for punch segment helpers — **Clock owns segment creation API** coordination with Admin)
- Test files: `src/app/components/employee/__tests__/Clock*.test.ts(x)`
- Clock-exclusive helper: to be created as `src/services/clockService.ts` if needed (owned by Clock)

**Explicit Forbid Globs** (Clock must never touch unless Manager issues signed override):
- `src/app/components/admin/**`
- `src/app/components/manager/**`
- Admin correction flows or audit log internals (except read)
- PayrollReports, bulk import, user management
- HR / leave folders once those exist

**Articles Clock Must Author**:
- `CLOCK_FEATURE_NOTES.md` (inside worktree) detailing punch rule decisions + edge cases + manual test steps.

**Related Collections (logical ownership context only)**:
- `timeEntries` — Clock is primary **creator** of new punch sessions; Admin later edits under its allowed rules.

---

### 2.2 Admin Agent — `feature/admin-timesheets`
**Core Mission**: Strengthen admin review, correction workflow (reason mandatory), write immutable audit entry on every correction, weekly timesheet view.

**Canonical Allow Globs**:
- `src/app/components/admin/AdminTimesheetReview.tsx` (new or refactor)
- `src/app/components/admin/CorrectionDialog.tsx` (new or strengthen)
- `src/app/components/admin/AuditLogViewer.tsx` (or extensions)
- Admin sparse helpers: `src/services/auditLogService.ts` (new)
- Updating `src/app/components/admin/AdminPanel.tsx` — **safe only in Admin-owned sections** (Manager diff review required)
- Corrections: `src/app/components/admin/CorrectionRequests.tsx`
- Related tests under `src/app/components/admin/**/__tests__/`

**Explicit Forbid for Admin** (unless Manager sign-off via chat):
- Employee clock/punch UI files (TodayEntry apart from read imports)
- Any employee-facing components under `src/app/components/employee/**` (new punch files, TodayEntry major rewrites)
- HR leave/vacation code paths
- New Firestore collections without Architecture buy-in

**Articles Admin Must Author**:
- `ADMIN_TIMESHEET_NOTES.md` — correction reason enforcement details, audit log schema decisions, manual test results.

**Related Collections**:
- `timeEntries` (edit under tight audit)
- New `auditLogs` collection — **Admin is primary writer** (governed by Architecture data model)
- `correctionRequests` (upgrade of existing)

---

### 2.3 HR Agent — `feature/leave-holidays`
**First Gate**: Plan + data model sketch only. No bulk feature code until Phase 2 explicit unlock.

**Phase-0 Allow (Plan Period)**:
- Only `HR_LEAVE_HOLIDAY_PLAN.md`
- Placeholder route stubs only if Manager approves short "does nothing" component (under `src/app/components/hr/` — discouraged in first run)

**Phase-2 Allow (Future)**:
- `src/app/components/hr/**`
- HR-related models + Firestore helper extensions (`vacationBalances`, `holidays`, `leaveRequests`)
- Configuration UIs for work week / expected hours

**Always Forbidden (HR)**:
- Employee punch time entry flows (Clock)
- Admin correction screens
- Audit log writing (except HR-initiated leave audit entries, to be defined later)

---

## 3. Shared / Infrastructure — Read-Only for All Non-Owner Agents

| File/Asset | Logical Owner (Design) | All Other Agents | Notes |
|------------|------------------------|------------------|-------|
| `src/app/lib/database.ts` | Architecture + (data shape); Clock & Admin each own **narrow sections** later | Forbid major rewrites; read + limited controlled extensions only via PR + Manager | Heavy coordination needed |
| `src/utils/timeValidation.ts` / `timeCalculations.ts` | Architecture (business rules) | Clock adds punch validation layer; QA reviews edge cases | Great care to avoid dupe logic |
| `src/app/lib/auth.ts` + `src/services/authService.ts` | Auth / Architecture | Read-only for all feature agents | Do not duplicate role check logic |
| `firestore.rules` | Architecture + QA | Forbid edits until Manager + QA dual approve | Often edited at end of architecture phase |
| `firebase.json` + hosting/runtime defaults | DevOps / none yet assigned | Forbid | No touch yet |
| `src/config/firebase.config.js` | Security risk (QA flagged) | Read + document exposure | Do not commit new secrets |
| Existing `docs/` guides & summaries | None (legacy) | Read | Do not overwrite without Manager + writer agreement |

---

## 4. New Artifacts Created by Multiple Agents — Namespace Protection

- `CLOCK_FEATURE_NOTES.md` → Worktree root only (Clock owns; later moved to docs/ on merge).
- `ADMIN_TIMESHEET_NOTES.md` → Same.
- `HR_LEAVE_HOLIDAY_PLAN.md` (HR) — distinct from Admin/CLOCK notes.
- Audit log helper implementation (`src/services/auditLogService.ts`) → Admin owns unless Architecture claims shared utility during design.

---

## 5. Conflict Escalation Process

1. Agent detects potential overlap (differing claims, simultaneous edits preview via git).
2. Agent immediately stops. Writes short "conflict report" into its worktree notes.
3. Escalates to Manager Agent in chat: "@manager-agent FILE CONFLICT — <file> claimed by Clock & Admin".
4. Manager:
   - Runs `git diff --name-status` cross-worktree comparison.
   - Temporarily pauses the second claimant.
   - Issues binding decision (ownership augmentation or split responsibility).
5. Manager records decision as an update to this WORKTREE_ASSIGNMENTS.md on its branch (requires merge propagation).
6. Only then do agents resume.

---

## 6. Quick-Reference Cheat Sheet — Print & Share With Agents

| If I'm... | I can safely work on... | I must never touch... | I must write notes at |
|-----------|--------------------------|-----------------------|-----------------------|
| Clock | src/app/components/employee/Clock*.tsx + limited punch rules in timeValidation + possible clockService | src/app/components/admin/**, firestore.rules (until cleared), HR paths | CLOCK_FEATURE_NOTES.md |
| Admin | Correction + admin review + dedicated auditLogService + admin panel owned slices | Employee TodayEntry major rewrites (unless Manager unlock), HR folders | ADMIN_TIMESHEET_NOTES.md |
| HR (plan) | HR_LEAVE_HOLIDAY_PLAN.md only; later leave components | All client clock & correction files | HR doc itself |
| QA | QA_* docs, testing & launch checklists. Can read absolutely everywhere. | Nothing read-restricted — but cannot edit source unless explicitly unlocked | In the three checklist docs |
| Manager | Only the three planning files + updating this matrix / merge order | Any application source | In git commits for planning branches |

---

**End of Matrix — Maintain via Manager Agent only. Update version with every change.**
