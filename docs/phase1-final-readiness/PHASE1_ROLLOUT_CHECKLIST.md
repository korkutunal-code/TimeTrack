# Phase 1 Rollout Checklist

Use this checklist to verify Phase 1 functionality before approving production deployment.

## Pre-Deploy

- [ ] `ready/phase1-staging` branch checked out
- [ ] `npm install` completed without errors
- [ ] `npm run build` completed successfully
- [ ] `npm run test` — all 11 tests pass
- [ ] Firebase staging project configured
- [ ] Firestore rules deployed to staging
- [ ] Firestore indexes deployed to staging
- [ ] At least one test admin user seeded

## Owner / Admin Test

- [ ] Admin can log in
- [ ] Admin panel loads with all tabs (Panel, Payroll, Audit, Metrics, Team, Corrections)
- [ ] Admin can create a new employee user
- [ ] Admin can view all users in the Manage Users table
- [ ] Admin can deactivate/reactivate a user
- [ ] Admin can access System Settings

## Manager Test

- [ ] Manager can log in
- [ ] Manager sees Team dashboard with employee list
- [ ] Manager sees "My Time" tab with punch clock
- [ ] Manager can clock in and out from "My Time" tab
- [ ] Manager can view team member time entries (read-only)

## Employee Test

- [ ] Employee can log in
- [ ] Employee sees Punch Clock as primary action
- [ ] Employee sees TodayEntry detail below punch clock
- [ ] Employee can view history

## Clock In / Out Test

- [ ] Employee taps CLOCK IN — status changes to CLOCKED IN
- [ ] Live PT time is displayed
- [ ] Today's running total updates
- [ ] Employee taps CLOCK OUT — status changes to CLOCKED OUT
- [ ] Total hours are calculated correctly

## Double Clock-In Block Test

- [ ] Employee clocks in
- [ ] Employee attempts to clock in again — button shows CLOCK OUT, not CLOCK IN
- [ ] Service rejects double punch-in with error message

## Missing Clock-Out Test

- [ ] Employee clocks in but does not clock out
- [ ] Next day, employee cannot clock in (open shift from previous day)
- [ ] Admin can see the incomplete entry in timesheet review
- [ ] Admin can correct the entry with proper clock-out time

## Admin Correction Reason Test

- [ ] Admin opens Correct Entry dialog
- [ ] Admin loads an employee entry
- [ ] Admin modifies times
- [ ] Admin attempts to save without notes — button is disabled
- [ ] Admin enters reason and saves — correction succeeds
- [ ] Entry status changes to "corrected"
- [ ] Audit log entry is created with before/after snapshots

## Audit Log Test

- [ ] Navigate to Audit tab
- [ ] Audit log entry appears for the correction just made
- [ ] Entry shows actor, timestamp, reason, before/after data
- [ ] Audit log entry cannot be edited (no edit/delete UI exists)
- [ ] Firestore rules prevent update/delete on auditLogs collection

## CSV Export Test

- [ ] Admin navigates to Weekly Timesheet Review
- [ ] Admin applies filters and loads entries
- [ ] Admin clicks Export Weekly CSV
- [ ] CSV file downloads with correct filename format
- [ ] CSV contains Date, Employee, Clock In, Clock Out, Hours, Status, Flags
- [ ] Payroll export (Payroll tab) still works independently

## Timezone Test

- [ ] All punch times display in Pacific Time (PT)
- [ ] Work date follows America/Los_Angeles calendar day
- [ ] Week summary uses PT week boundaries (Sunday start)
- [ ] Changing browser timezone does not affect stored times

## Mobile Test

- [ ] Punch clock loads on iOS Safari
- [ ] Punch clock loads on Android Chrome
- [ ] CLOCK IN/OUT button is large and easy to tap
- [ ] Lunch toggle is accessible
- [ ] Page is responsive and does not overflow horizontally

## Staging Deploy Check

- [ ] `firebase deploy --only firestore:rules,firestore:indexes` succeeds
- [ ] `firebase deploy --only hosting` succeeds (if applicable)
- [ ] Staging URL is accessible
- [ ] Login works on staging
- [ ] All above tests pass on staging environment

## Production Approval Gate

- [ ] All checkboxes above are checked
- [ ] Owner/admin has reviewed staging test results
- [ ] Owner/admin has explicitly approved production deployment
- [ ] Production Firebase project is configured
- [ ] Production Firestore rules are deployed
- [ ] Production test users are seeded

**DO NOT deploy to production until the Production Approval Gate is fully checked and signed off.**
