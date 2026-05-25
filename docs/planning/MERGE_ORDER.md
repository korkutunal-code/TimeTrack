# MERGE_ORDER.md — Controlled Integration Sequence (First Run Emphasis)

**Rule**: Do not merge agents out of sequence. Each merge must be preceded by human + manager explicit approval.

---

## Approved Sequential Merge Order

| Order | Branch / Worktree | Primary Deliverables on Branch | When to Merge | Rationale & First-Run Specifics |
|-------|-------------------|--------------------------------|---------------|---------------------------------|
| 1 | `audit/current-app-review` | `PROJECT_AUDIT.md` | After Manager has staged this file in planning worktree + human reviews the audit doc | **Baseline truth**. No design or code can proceed safely without knowing what already exists, what works, what is fragile. In first run, this is the FIRST non-planning document reviewed. |
| 2 | `architecture/hr-time-structure` | `ARCHITECTURE_PLAN.md` + `FIRESTORE_DATA_MODEL.md` + `SECURITY_RULES_PLAN.md` | Only AFTER Audit doc accepted and human verbally approves "Architecture gate open". QA agent may be spawned concurrently but cannot merge before this order slot. | All future data structures, RBAC rules, audit log expectations, and America/Los_Angeles timezone mandate must be ratified before any punch or correction code is written. |
| 3 | `qa/testing-security` | `QA_SECURITY_REVIEW.md`, `TESTING_CHECKLIST.md`, `LAUNCH_CHECKLIST.md` | After Architecture + Audit are both staged & approved. May run in parallel to Architecture work but merges only here. | Catch latent security / test gaps (Firebase rules leakage, role escalation paths, correction audit integrity, timezone hazards, deployment secrets exposure) **before** any feature code branches attempt edits. In first run this validates the entire pre-code risk surface. |
| 4 | `feature/punch-clock` | Working punch-in/out flow + `CLOCK_FEATURE_NOTES.md` + tests | **After** QA + Architecture + Audit have merged or at minimum their docs are converged into main planning review. Manager must issue explicit "Clock green-light" instruction. | Employee clock-in/out is the highest-frequency daily action and the core value of Phase 1. Smallest surface-area change for highest user impact. |
| 5 | `feature/admin-timesheets` | Admin review/correction with **mandatory reason** + per-correction immutable audit trail + weekly view + `ADMIN_TIMESHEET_NOTES.md` + tests | Follows Clock merge. Admin correction code must reference stable punch segment model from Clock + data model ratified by Architecture. | Higher blast radius (editing other peoples' time). Must sit atop proven clock baseline and enforced audit logging. |
| 6 | `feature/leave-holidays` | `HR_LEAVE_HOLIDAY_PLAN.md` (already produced) + later full vacation/sick/holiday/work-week/expected-hours/approval implementation | Only after Phases 1 (Clock + Admin review) are stable in production or near-production for at least one sprint, and after Manager + human sign-off for Phase 2. | Expansion of system scope; risk of scope creep / incomplete calendar logic if introduced too early. |

---

## First-Run Adaptation (Planning Only)

- Current run stops at **step 3** (QA merge).
- Agents 4-6 are created as empty/stub worktrees **but receive no feature edit permission**.
- After documents 1-3 (and planning trio) are complete + human approves, the next experiment will activate Clock gate.
- Any attempt to accelerate past this during first run must raise immediate Manager alarm.

---

## Gate Checklist Before Each Merge (To Be Verified by Manager)

For each merge candidate:

- [ ] All required doc(s) exist in the worktree with non-placeholder substance.
- [ ] Agent has appended a short "What Changed / Files Touched" summary paragraph at the end of their primary deliverable.
- [ ] Git diff against `main` (or `planning/hr-time-manager` merge base) shows **zero** unintended file crossing (enforced via `git diff --name-status`).
- [ ] Agent verbally confirmed in chat: "I touched only my allowed globs per WORKTREE_ASSIGNMENTS.md".
- [ ] (Future phases) Build/lint/test commands passed inside the worktree if feature code changed.

Additional First-Run Gate (docs-only):
- Every agent doc contains this sentence verbatim near top: "No production source code or security rule changes made by this agent during first-run planning phase."

---

## Rollback / Reversion Rules

- If post-merge issues surface: Manager can authorize `git revert` of only the guilty range without forcing other agents to rebase.
- Clock merge can be reverted independently of Admin without cascading revert.

---

## Quick Command Patterns (Manager Use)

When ready to open gate in chat:
```
@manager-agent
Approve merge order slot <N> for <branch>.
Reason: <...>
```

Inside worktree shell to produce clean diff (Manager):
```
git fetch origin
git diff --name-status origin/main...HEAD
```

---

**Owner**: Manager Agent only.  
**Last Updated**: 2026-05-25 (First Run Edition)  
**Next Expected Update**: Upon successful QA merge completion + Clock gate decision.

Print this alongside WORKTREE_ASSIGNMENTS.md for every agent briefing.
