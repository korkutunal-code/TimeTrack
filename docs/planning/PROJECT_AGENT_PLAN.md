# PROJECT_AGENT_PLAN.md — Multi-Agent Coordination Plan for TimeTrack HR/Time Tracking

**Project**: https://github.com/torosasik/TimeTrack  
**Business**: Internal employee time tracking for American Tile Depot (NOT client billing / freelancer / invoicing).  
**Phase Gate**: Planning + audit documents complete (first run delivered 2026-05-25). **Phase 1 authorized** — proceed with punch-clock + admin-timesheets work in parallel where ownership allows. No waiting on separate human sign-off beyond this point.

## 1. Overall Purpose
Implement a safe, parallel multi-agent development process using Kilo CLI managed worktrees + git branches for separate agent "lanes".

The goal is to validate the manager/agent/worktree coordination system **before any functional code is written or modified**.

## 2. Workstream Agents and Worktree/Branch Mapping

| Agent | Branch/Worktree Path | Primary Responsibility | Code Changes Allowed? | Must Wait For |
|-------|-----------------------|------------------------|-------------------------|---------------|
| Manager Agent | planning/hr-time-manager | Coordination, file ownership, final merge ordering, risk prevention. | **NO** | — |
| Audit Agent | audit/current-app-review | Current app review, tech stack, Firebase, auth, roles, business logic, gaps, risks. | **NO** | — |
| Architecture Agent | architecture/hr-time-structure | Future design: data model, collections, RBAC, audit trails, timezone standardization, integration points (future only). | **NO (design docs only)** | Audit complete |
| QA/Security Agent | qa/testing-security | Firebase rules review, role abuses, timezone & correction integrity, checklists. | **NO** unless explicit manager unlock | Architecture + Audit |
| Clock Agent | feature/punch-clock | Implement Phase 1 employee punch-in/out, simple phone UI, double-tap prevention, emergency break support, related tests + CLOCK_FEATURE_NOTES.md. | YES (restricted) | Architecture/audit/QA docs complete. Parallel execution allowed; Manager arbitrates file conflicts. |
| Admin Agent | feature/admin-timesheets | Admin review/correction flow with mandatory reason + immutable audit log entries, weekly timesheet view, ADMIN_TIMESHEET_NOTES.md. | YES (restricted) | Architecture/audit/QA docs complete. Parallel execution allowed with Clock lane (ownership matrix enforced). |
| HR Agent | feature/leave-holidays | HR leave/holiday/work-week plan + (later) implementation. HR_LEAVE_HOLIDAY_PLAN.md first; actual features gated. | Plan first; code only with explicit Manager OK | Clock + Admin Phase 1 stable |

## 3. Global Invariant Rules (Embedded in Every Agent Prompt)

1. **No Operation Hub integration** during Phases 1-2.
2. **No wholesale rewrite** — preserve existing Firebase + React + TS foundation.
3. **No direct copy** of OrangeHRM, Kimai, or TimeTrex source.
4. **Default timezone = America/Los_Angeles** for all storage, calculations, scheduling, exports.
5. **Every admin correction requires a non-empty human reason**; written to audit trail.
6. **Never hard-delete time records.** States: `active`, `corrected`, `voided`, `archived`.
7. **Employee phone UX** remains 1-2 taps for clock-in/out.
8. No billing/invoicing/client/project features.
9. Each sub-agent **must** produce a one-paragraph "What I Changed + Files Touched" summary before asking for merge.
10. File ownership conflicts are blocked by Manager; no overlapping agent edits without written OK.
11. All agents must respect explicit "Allowed Areas" sections in their individual prompts.

## 4. Phase Strategy

**Phase 0 (Completed — 2026-05-25)**:
- All 11 planning/audit/design docs delivered.
- Zero source edits performed.

**Phase 1 (AUTHORIZED — proceed)**:
- Punch clock + employee view (today/this week) + no double-punch + simple lunch toggle.
- Admin review list + correction with mandatory reason + immutable audit log per change.
- Existing CSV export remains 100% compatible.
- Zero Operation Hub touch.
- Workstreams may execute in parallel using separate worktrees/branches where file ownership permits; Manager arbitrates any conflicts.

**Phase 2 (After Phase 1 Stable)**:
- Vacation / sick / unpaid leave.
- Public holidays.
- Configurable work week + expected hours.
- Timesheet approval workflow.
- Payroll export enhancements.

**Phase 3 (Separate Future Program)**:
- Operation Hub integration (shared login subset, navigation, push/pull APIs). **Decision gate required.**

## 5. Required First-Run Deliverables (Planning + Audit Only)

Produced in respective worktrees (do NOT edit source tree):

1. `planning/hr-time-manager/`
   - PROJECT_AGENT_PLAN.md (this file)
   - WORKTREE_ASSIGNMENTS.md
   - MERGE_ORDER.md
2. `audit/current-app-review/`
   - PROJECT_AUDIT.md
3. `architecture/hr-time-structure/`
   - ARCHITECTURE_PLAN.md
   - FIRESTORE_DATA_MODEL.md
   - SECURITY_RULES_PLAN.md
4. `qa/testing-security/`
   - QA_SECURITY_REVIEW.md
   - TESTING_CHECKLIST.md
   - LAUNCH_CHECKLIST.md
5. `feature/leave-holidays/`
   - HR_LEAVE_HOLIDAY_PLAN.md (plan-first; placeholder components only if explicitly approved)

All 10 documents must exist with non-placeholder, repository-grounded content before Phase 1 gate.

## 6. Agent Prompts & Switching (Implementation Details)

- Each agent receives the **short dedicated prompt block** provided by the human + the current state of the shared plans.
- Agent runs inside its worktree root (path isolated by Kilo Agent Manager).
- Use relative `../..` only for repo roots when reading; **never** mutate outside worktree.
- Manager agent uses `task` + verbal coordination to sub-agents.
- Audit + architecture may run concurrently after manager plan is staged; QA waits for their docs.

## 7. File Ownership & Conflict Prevention (See WORKTREE_ASSIGNMENTS.md)

Manager maintains canonical `WORKTREE_ASSIGNMENTS.md` listing:
- Per-agent allow-globs (ex: `src/app/components/employee/TodayEntry.tsx` → Clock)
- Per-agent forbid-globs
- Shared data model files (read-only)
- Collections (logical)

Any agent attempting edit of a file it does not own triggers immediate stop and escalation to Manager.

## 8. Merge Order (See Also MERGE_ORDER.md)

Strict sequential human-approved merges. Never squash all PRs at once.

Complete table:

| Order | Branch/Worktree | Reason |
|-------|-----------------|--------|
| 1 | audit/current-app-review | Baseline understanding before design or any code |
| 2 | architecture/hr-time-structure | Approve data model + security posture before any clock or admin work starts |
| 3 | qa/testing-security | Surface latent security/test gaps before feature code lands |
| 4 | feature/punch-clock | Core employee function; smallest safe delta |
| 5 | feature/admin-timesheets | Admin review/correction is high-risk—follows clock baseline |
| 6 | feature/leave-holidays | HR expansion only after clock + correction scaffolding proven |

Manager must update this table after each gate and before authorizing next agent start.

## 9. Quality Gates Before Each Merge

For planning docs:
- Spelling, completeness, explicit "Files I Read" section.
- Explicit statement: "Zero source code or rule changes performed by this agent."

For future code phases (not this run):
- `npm run lint` clean
- `npm run typecheck` clean
- Relevant Jest tests (new + existing) pass
- Manual test of critical path demonstrated
- In-worktree `CLOCK_FEATURE_NOTES.md` / `ADMIN_TIMESHEET_NOTES.md` written
- Manager performs final ownership diff (`git diff --name-status origin/main`)

## 10. Communication & Hand-off Cadence

- Each agent finishes with:
  - Summary paragraph
  - List of files (only within its worktree)
  - Explicit "Ready for manager review"
- Manager confirms receipt, cross-checks ownership matrix, updates merge order if necessary, then signals "gate approved" for next agent.

## 11. Emergency Stops

Manager authority (in chat):
- "PAUSE ALL AGENTS — FILE OWNERSHIP VIOLATION"
- "REVOKE CODE CHANGE PERMISSION UNTIL REVIEW"
- "ABORT CURRENT AGENT WORKTREE"

Any agent receiving these verbal commands must immediately exit edit loop and await rescue.

## 12. Future Tooling / Command Wrappers

Potential later addition (outside first run scope):
- `.kilo/command/time-track-plan.md` (human macro command to boot new coordinated session)
- Automation to scaffold worktree + seed base docs for a new agent.

## 13. Success Criteria for This First Experiment

- All 10 required docs exist and are substantive.
- `git diff --name-only` against main for the entire duration of planning run reports zero `src/**` or `firebase*` files.
- Every doc ends with "No production code changes made by [Agent]".
- Clear textual chain: Audit → Architecture → QA → (future) Clock.
- Manager approves move to Phase 1 by written sign-off only after human review.

---

**Document Owner**: Manager Agent (planning/hr-time-manager)  
**Version**: 2026-05-25 First Run  
**Status**: Ready for human review + explicit "Proceed to create next agent worktrees" signal.

All sub-agents inherit this document + their dedicated short prompt as primary context.
