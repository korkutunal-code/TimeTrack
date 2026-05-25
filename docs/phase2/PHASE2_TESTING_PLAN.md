# Phase 2 Testing Plan

**Date:** 2026-05-25  
**Status:** Draft

## Overview
Comprehensive testing strategy for Phase 2 HR leave and timesheet approval features.

## Test Categories

### 1. Unit Tests
**Scope:** Pure functions, services, utilities

#### Leave Balance Calculations
- Opening balance + accrued - used - pending = available
- Edge cases: negative balance, zero balance, overflow
- Timezone handling (America/Los_Angeles)

#### Date Range Validation
- Start date <= end date
- No overlapping approved requests
- Weekend/holiday exclusion
- Work days calculation

#### Status Transitions
- Valid transitions only
- Invalid transitions rejected
- Audit log created before mutation

#### Security Rules
- Role-based access control
- Field-level validation
- Status transition enforcement

### 2. Integration Tests
**Scope:** Workflows, API calls, Firestore operations

#### Leave Request Workflow
1. Employee creates request
2. Balance updated (pending++)
3. Manager approves
4. Balance updated (pending--, used++)
5. Audit log created

#### Timesheet Approval Workflow
1. Employee submits timesheet
2. Status changes to 'submitted'
3. Manager approves
4. Status changes to 'approved'
5. Audit log created

#### Payroll Export
1. Query approved timesheets
2. Query approved leave
3. Generate CSV
4. Validate format compatibility

### 3. Security Rules Tests
**Scope:** Firestore security rules validation

#### leaveTypes
- Admin can create/update
- Employee cannot modify
- All can read

#### leaveRequests
- Employee can create own
- Employee cannot create for others
- Manager can approve team
- Employee can cancel own pending

#### timesheetApprovals
- Employee can submit own
- Manager can approve team
- Admin can correct approved
- Immutable audit trail

### 4. Manual Tests
**Scope:** UX, accessibility, edge cases

#### Mobile Usability
- Leave request in 2-3 taps
- Timesheet submission on phone
- Approval actions on tablet

#### Accessibility
- Screen reader navigation
- Keyboard-only operation
- Color contrast validation

#### Edge Cases
- Concurrent approvals
- Manager role change mid-week
- Timezone edge cases (DST transitions)
- Large datasets (100+ employees)

## Test Data

### Seed Data
- 5 leave types (vacation, sick, unpaid, bereavement, jury duty)
- 10 public holidays (US federal)
- 3 work schedules (default, part-time, custom)
- 20 employees (various roles)
- 50 leave requests (various statuses)
- 100 timesheet approvals (various weeks)

### Test Users
- admin@test.com (full access)
- manager@test.com (team approval)
- employee@test.com (self-service)
- inactive@test.com (disabled account)

## Test Environment

### Local Development
- Jest for unit tests
- Firebase emulator for rules tests
- Playwright for E2E tests (future)

### Staging
- Firebase staging project
- Real Firestore data
- Manual testing by team

### Production
- Monitoring and alerting
- Error tracking
- Performance metrics

## Coverage Goals

| Category | Target | Current |
|----------|--------|---------|
| Unit tests | 80% | 0% (Phase 2) |
| Integration tests | 60% | 0% (Phase 2) |
| Security rules | 100% | 0% (Phase 2) |
| Manual tests | All workflows | 0% (Phase 2) |

## CI/CD Integration

### Pre-merge Checks
1. Unit tests pass
2. TypeScript compiles
3. Build succeeds
4. Lint passes (no new errors)

### Post-merge Checks
1. Integration tests pass
2. Security rules tests pass
3. Deploy to staging
4. Smoke tests on staging

## Reporting

### Test Reports
- Unit test coverage report
- Integration test results
- Security rules validation
- Manual test checklist

### Metrics
- Test execution time
- Flaky test rate
- Coverage trends
- Bug escape rate
