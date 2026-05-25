# Phase 2 Master Plan: HR Leave & Holidays

**Date:** 2026-05-25  
**Status:** Planning  
**Depends on:** Phase 1 hardening merge

---

## Overview

Phase 2 extends TimeTrack from basic clock-in/out to a complete HR attendance system with leave management, public holidays, work schedules, and timesheet approval workflows.

---

## Goals

1. **Leave Management**: Employees can request time off; admins/managers approve/deny
2. **Public Holidays**: Company-wide holiday calendar
3. **Work Schedules**: Define expected work days and hours per employee
4. **Timesheet Approval**: Weekly timesheet submission and approval workflow
5. **Payroll Export**: Prepare data for payroll provider integration (future)

---

## Non-Goals (Phase 2)

- ❌ Payroll provider integration (Phase 3+)
- ❌ Complex California labor compliance calculations
- ❌ Sensitive HR documents (contracts, performance reviews)
- ❌ Operation Hub integration
- ❌ Freelancer/contractor management
- ❌ Billing or project tracking

---

## Features

### 1. Leave Types
**Purpose:** Define categories of time off  
**Examples:** Vacation, Sick, Unpaid, Bereavement, Jury Duty  
**Admin Controls:** Create/edit leave types, set accrual rules (future)

### 2. Leave Balances
**Purpose:** Track available leave per employee per type  
**Calculation:** Opening balance + accrued - used = available  
**Phase 2 Scope:** Manual balance adjustment by admin (no auto-accrual yet)

### 3. Leave Requests
**Purpose:** Employee self-service time off requests  
**Workflow:** Employee requests → Manager/Admin approves/denies → Balance updated  
**Status Flow:** `pending` → `approved` | `denied` | `cancelled`

### 4. Public Holidays
**Purpose:** Company-wide non-working days  
**Scope:** Admin manages holiday calendar  
**Timezone:** America/Los_Angeles (company default)

### 5. Work Schedules
**Purpose:** Define expected work days and hours  
**Scope:** Simple weekly schedule (Mon-Fri, 8h/day default)  
**Future:** Shift patterns, flexible schedules

### 6. Timesheet Approval
**Purpose:** Weekly timesheet submission and manager approval  
**Workflow:** Employee submits → Manager approves/rejects → Payroll ready  
**Status Flow:** `draft` → `submitted` → `approved` | `rejected` | `corrected`

### 7. Payroll Export Preparation
**Purpose:** Aggregate approved hours for payroll processing  
**Scope:** CSV export with approved timesheets + leave  
**Compatibility:** Preserve existing payroll CSV format

---

## Data Model

See [PHASE2_DATA_MODEL.md](./PHASE2_DATA_MODEL.md) for detailed schema.

### Collections

| Collection | Purpose | Key Fields |
|------------|---------|------------|
| `leaveTypes` | Leave categories | name, color, accrualEnabled |
| `leaveBalances` | Available leave per employee | userId, leaveTypeId, balance |
| `leaveRequests` | Time off requests | userId, leaveTypeId, startDate, endDate, status |
| `publicHolidays` | Company holidays | date, name, recurring |
| `workSchedules` | Expected work patterns | userId, daysOfWeek, hoursPerDay |
| `timesheetApprovals` | Weekly approval records | userId, weekStart, status, approvedBy |
| `approvalHistory` | Audit trail for approvals | approvalId, action, actor, timestamp |

---

## Security Rules

See [PHASE2_SECURITY_RULES_PLAN.md](./PHASE2_SECURITY_RULES_PLAN.md) for detailed rules.

### Principles

1. **Employees** can view/create their own leave requests and timesheets
2. **Managers** can view/approve their team's requests and timesheets
3. **Admins** have full access to all leave and approval data
4. **Audit trail** for all approval/denial actions
5. **Immutable** approval history (append-only)

---

## UI Plan

See [PHASE2_UI_PLAN.md](./PHASE2_UI_PLAN.md) for detailed wireframes.

### Employee View
- **Leave Dashboard**: Available balances, pending requests, request new leave
- **Timesheet View**: Weekly hours, submit for approval, view status
- **Calendar View**: Holidays, approved leave, work schedule

### Manager View
- **Team Leave**: Pending requests, approve/deny, team calendar
- **Team Timesheets**: Submitted timesheets, approve/reject, weekly summary

### Admin View
- **Leave Types**: Create/edit leave types
- **Public Holidays**: Manage holiday calendar
- **Work Schedules**: Set default schedules per employee
- **Reports**: Leave usage, approval metrics

---

## Implementation Plan

See [PHASE2_AGENT_WORKTREE_PLAN.md](./PHASE2_AGENT_WORKTREE_PLAN.md) for worktree assignments.

### Phase 2A: Foundation (Week 1-2)
1. `leaveTypes` collection + admin UI
2. `publicHolidays` collection + admin UI
3. `workSchedules` collection + admin UI

### Phase 2B: Leave Requests (Week 3-4)
1. `leaveRequests` collection + employee UI
2. `leaveBalances` calculation + display
3. Manager approval workflow

### Phase 2C: Timesheet Approval (Week 5-6)
1. `timesheetApprovals` collection
2. Employee submission UI
3. Manager approval UI
4. `approvalHistory` audit trail

### Phase 2D: Integration (Week 7-8)
1. Payroll export with leave data
2. Calendar integration (holidays + leave)
3. Testing and documentation

---

## Testing Plan

See [PHASE2_TESTING_PLAN.md](./PHASE2_TESTING_PLAN.md) for detailed test cases.

### Unit Tests
- Leave balance calculations
- Status transitions
- Date range validation
- Security rules

### Integration Tests
- Leave request workflow
- Timesheet approval workflow
- Payroll export with leave data

### Manual Tests
- Mobile usability for leave requests
- Manager approval flow on tablet
- Admin configuration workflows

---

## Risks & Mitigations

### 1. Data Model Complexity
**Risk:** Leave balances calculation requires careful transaction handling  
**Mitigation:** Use Firestore transactions, add comprehensive unit tests

### 2. Approval Workflow Edge Cases
**Risk:** Concurrent approvals, manager changes mid-week  
**Mitigation:** Status-based workflow, audit trail, clear error messages

### 3. Payroll Compatibility
**Risk:** New data breaks existing CSV format  
**Mitigation:** Preserve existing format, add new columns only

### 4. Performance
**Risk:** Large datasets (hundreds of employees, years of history)  
**Mitigation:** Pagination, indexes, query optimization

---

## Success Criteria

1. ✅ Employees can request leave in 2-3 taps
2. ✅ Managers can approve/deny requests with reason
3. ✅ Leave balances update automatically on approval
4. ✅ Timesheets can be submitted and approved weekly
5. ✅ Payroll export includes approved leave and timesheets
6. ✅ All approval actions have audit trail
7. ✅ Mobile-first design for all employee actions
8. ✅ No breaking changes to Phase 1 clock functionality

---

## Dependencies

### Phase 1 (Required)
- ✅ Clock-in/out functionality
- ✅ Audit log service
- ✅ Security rules foundation
- ✅ User roles (employee, manager, admin)

### External (None for Phase 2)
- ❌ No payroll provider integration yet
- ❌ No external holiday API
- ❌ No email/SMS notifications (future)

---

## Timeline

| Phase | Duration | Deliverables |
|-------|----------|--------------|
| 2A: Foundation | 2 weeks | Leave types, holidays, schedules |
| 2B: Leave Requests | 2 weeks | Employee requests, manager approval |
| 2C: Timesheet Approval | 2 weeks | Submission, approval, audit trail |
| 2D: Integration | 2 weeks | Payroll export, testing, docs |
| **Total** | **8 weeks** | **Complete HR leave system** |

---

## Next Steps

1. Review and approve this master plan
2. Finalize data model and security rules
3. Create worktree assignments for parallel development
4. Begin Phase 2A implementation
5. Weekly progress reviews

---

*Document generated by Overnight Manager Agent*
