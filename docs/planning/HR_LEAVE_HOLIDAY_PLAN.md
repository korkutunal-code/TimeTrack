# HR_LEAVE_HOLIDAY_PLAN.md — Vacation, Sick Leave, Unpaid Leave, Holidays, Work Week & Expected Hours (Phase 2 Planning Document)

**Agent**: HR Agent  
**Worktree**: feature/leave-holidays (planning phase only)  
**Date**: 2026-05-25  
**Constraint (First Run)**: Pure planning. This document is the **only** artifact produced in this worktree during the first experiment. No placeholder routes, components, or collections are created yet.

---

## 1. Executive Intent

Per the master prompt:
- This is **not** a freelancer billing system.
- The future HR module exists to support **employees** of American Tile Depot: accrued vacation, sick leave usage, public holidays, unpaid leave, defined work weeks, expected hours per pay period, and timesheet approval workflows that feed future payroll exports.
- **Do not build yet**. First create a solid, Architecture-aligned plan so that when Phase 2 is unlocked, Clock + Admin foundations are not destabilized.

This plan references:
- PROJECT_AUDIT.md (current state gaps)
- ARCHITECTURE_PLAN.md + FIRESTORE_DATA_MODEL.md (Phase 2 collections already stubbed)
- SECURITY_RULES_PLAN.md (leave collections start locked)

---

## 2. Business Context (American Tile Depot)

- US company, California operations (hence strong existing CA overtime engine).
- Likely multi-location tile supply/warehouse + possible field crews + office.
- Employees work full-time, part-time, seasonal.
- Current pain: manual tracking of vacation/sick days, inconsistent holiday pay, difficulty computing "expected vs. actual" hours for payroll, no integrated leave requests with manager approval chain.

Reference systems:
- **OrangeHRM** (primary): Employee self-service leave requests, leave types, leave balances, holiday calendar, work week definitions.
- **Kimai** (secondary): How leave interacts with timesheets (subtracting leave hours from expected work day).

Phase 2 in this system must produce payroll-grade expected vs. actual blobs without becoming a full HRIS.

---

## 3. Scope Boundary (What This Module Is / Is Not)

**In scope for Phase 2**:
- Configurable leave types: Vacation, Sick, Unpaid, Bereavement, Jury, etc.
- Leave request + approval flow (employee request → manager → optional admin escalation).
- Accrual engine (simple: per-hour / per-pay-period / annual grant).
- Public holidays (US/CA federal + state + company-specific) with "observed" rules.
- Work week definition per policy (start day, expected minutes).
- Daily/weekly expected hours per policy linked to employees.
- Timesheet approval (manager signs off on a week or pay period).
- Payroll export enrichment (regular + OT + leave hours broken out).

**Out of scope (Phase 3+ or never here)**:
- Full employee onboarding / self-service profile.
- Benefits enrollment.
- Performance management.
- Time-off balance projections based on future scheduled work.
- Direct integration to ADP/Gusto/Paychex (that becomes external payroll exporter).

---

## 4. Phase 2 Data Model Additions (Already Designed)

From FIRESTORE_DATA_MODEL.md (Phase 2 HR section):

### 4.1 Core Collections

**leaveRequests**
- employeeUid, requestedBy
- leaveType, startDate, endDate (PT logical days)
- durationMinutes / durationDays
- status + approver decision fields
- relatedAuditLogIds[] (ties to the new immutable audit trail)
- createdAt

**vacationBalances** (per employee roll-up)
- accruedMinutes, usedMinutes, carriedOver
- asOfDate, policyId
- Updated by accrual jobs + on leave approval

**holidays**
- date (as doc ID key)
- name, type (federal / state_ca / company)
- observedRule (nearest_weekday etc.)
- active flag, optional locations

**workPolicies**
- Work week start day (0=Sun), expectedWeeklyMinutes
- overtimeRules (extension point beyond CA)
- leaveAccrual config (accrual rate, cap, carry-over rules)
- effectiveFrom / supersedes

These are **read-denied** in Phase 1 rules per SECURITY_RULES_PLAN stub.

---

## 5. Key Business Rules to Encode

### 5.1 Leave Types
- **Vacation**: Accrues. Can be scheduled in advance. May require notice.
- **Sick**: Accrues or granted. Can be used retroactively same-day in many US jurisdictions. Manager notification instead of pre-approval.
- **Unpaid**: Always available; does not deduct from PTO bank. Still reduces expected hours.
- **Bereavement / Jury / Other**: Special paid or unpaid buckets.

### 5.2 Accrual Engine
- Base assumption: hours-based (e.g., 0.0385 vacation hours per regular hour worked) — common in CA to avoid "use it or lose it" legal issues.
- Can also support: fixed grant on anniversary, monthly front-load.
- Cap + carry-over governed by policy.
- `vacationBalances` must be recomputable from history if needed for legal defense.

### 5.3 Holidays
- Company observes specific dates; some "floating holidays".
- Holiday pay logic: If employee is normally scheduled on a holiday, they receive pay for the usual expected hours (or separate holiday bucket).
- Interaction with leave: Holiday overrides any scheduled vacation request on that calendar day.

### 5.4 Timesheet Approval Flow
- Once the Clock + Admin system proves stable, add "Submit for Approval" on pay-period close.
- Manager reviews actual vs. expected (including leave + holidays).
- Approval writes another audit log row.
- Approved periods become read-only for non-admin (similar to existing completed status but stronger).

### 5.5 Payroll Export Implications (Phase 2 Output)
Enriched CSV / JSON export (building on existing PayrollReports export) should contain per pay-period:
- Regular hours actually worked
- OT / Double time
- Vacation hours paid
- Sick hours paid
- Other leave
- Holiday pay hours
- Unpaid leave (for deduction)
- Net expected vs. actual variance

Must remain compatible with whatever payroll provider (ADP/Gusto/etc.) the company uses.

---

## 6. UI / UX Sketch (High Level — No Implementation Yet)

**Employee Self-Service (new HR tab after Phase 2 gate)**:
- My Leave Balances (Vacation 42.5 hrs, Sick 20 hrs…)
- Request Leave (calendar picker, leaveType dropdown, note)
- My Upcoming Approved Leaves + Pending
- View Holidays (read-only calendar)

**Manager**:
- Team Leave Calendar (who is out when)
- Approve/Reject requests queue
- Team expected vs. actual variance on timesheet approval

**Admin**:
- Leave type & accrual policy editor
- Holiday calendar maintenance
- Work policy assignment to groups or individuals
- Payroll export configuration (which columns)

**Mobile Priority**: Leave request submission must also work in ≤2 taps on phone (parallel to punch clock goal).

---

## 7. Integration Points with Phase 1 Foundation

- **Clock / Segments**: Leave will subtract hours from the "expected" day when computing variance. Actual punch data remains unchanged.
- **Admin Corrections**: A correction to a day that intersected approved leave must trigger audit log + possible recalc of leave balance (HR-owned service, not Clock).
- **Audit Trail**: Every leave approval, balance adjustment, policy change, holiday override writes to `auditLogs` collection with targetCollection `leaveRequests` or `vacationBalances`.
- **Timezone**: All leave date ranges stored in `America/Los_Angeles`.

---

## 8. Risks & Open Questions (To Be Resolve Before Phase 2 Code)

1. Legal accrual rules in California (no "use it or lose it").
2. How to handle retroactive sick days when employee punches late.
3. Carry-over policy vs. payout on termination / year end.
4. Part-time vs. full-time expected hours (policies must support variable FTE).
5. Manager approval delegation when manager is on leave.
6. How "floating holidays" book-keeping works for payroll.
7. Exact payroll provider file format (CSV columns) required for Phase 2 export — need sample from finance team.

**Mitigation**: Before Phase 2 kickoff, HR Agent (or manager) must schedule 60-min working session with Payroll + Ops stakeholders to lock these answers.

---

## 9. Dependency on Other Workstreams

- **Cannot begin serious coding** until:
  - Phase 1 Clock + Admin correction+audit are merged and stable (>1 payroll cycle).
  - Audit + Architecture + QA docs are in main reviewing the new `auditLogs` enforcement reality.
- **Clock Agent** owns any helper that injects "leaveDeductedMinutes" onto a TimeEntry read view.
- **Admin Agent** may later need new screens for leave-impacted corrections.
- **QA Agent** (in future Phase 2 gate) will need new test cases around expected hour calculations with holidays + approved vacation.

---

## 10. Staged Rollout Recommendation (Post-Architecture)

1. **Policy & Holiday Editor** (Admin only; no employee impact yet).
2. **Leave Request + Balances** (employee self-service + manager approval; no timesheet interaction).
3. **Holiday Pay** + **Expected Hours Variance** display in timesheets.
4. **Timesheet Approval Workflow** gated behind manager sign-off.
5. **Payroll Export Enrichment**.
6. **Full Phase 2 launch**, including policy migration for existing employees.

Each sub-stage produces its own short HR_AGENT sub-notes doc modeled after CLOCK_FEATURE_NOTES.md pattern.

---

## 11. Non-Functional Requirements

- Leave balances must be provably reconstructible from audit logs + raw leaveRequests for 7+ years.
- No more than one pending leave request per employee at a time for the same date range (business rule).
- System must continue functioning for employees without any leave policy assigned (graceful "no accrual").

---

## 12. First-Run Agent Sign-Off

**HR Agent (planning phase only)**:
- This document is the sole deliverable.
- References and respects the Phase 1 architecture & security gates.
- No code, no stubs, no early collections were introduced.
- Ready for future Phase 2 unlock by Manager after human approval.

**Referenced by**: Manager merge order (step 6) and future feature/leave-holidays worktree coordination.

---

Next expected human action after this gate: Review across all planning docs, then consider spawning or activating the QA/Security agent.
