# Phase 2 Security Rules Plan

**Date:** 2026-05-25
**Status:** Draft

## Overview

Security rules for Phase 2 collections: `leaveTypes`, `leaveBalances`, `leaveRequests`, `publicHolidays`, `workSchedules`, `timesheetApprovals`, `approvalHistory`.

## Principles

1. Employees can view/create their own leave requests and timesheets
2. Managers can view/approve their team's requests and timesheets
3. Admins have full access to all leave and approval data
4. Audit trail for all approval/denial actions
5. Immutable approval history (append-only)

## Collection Rules

### leaveTypes

- **Read:** All authenticated active users
- **Create/Update:** Admin only
- **Delete:** Never (soft delete via `status` field)

### leaveBalances

- **Read:** Employee (own), Manager (team), Admin (all)
- **Create/Update:** Admin only (manual adjustments)
- **Delete:** Never

### leaveRequests

- **Create:** Employee (own requests only, must be active)
- **Read:** Employee (own), Manager (team), Admin (all)
- **Update:**
  - Employee can cancel own pending requests
  - Manager/Admin can approve/deny pending requests
  - Status transitions validated
- **Delete:** Never (use `status='cancelled'`)

### publicHolidays

- **Read:** All authenticated active users
- **Create/Update/Delete:** Admin only

### workSchedules

- **Read:** Employee (own), Manager (team), Admin (all)
- **Create/Update:** Admin only
- **Delete:** Never (use `effectiveTo` date)

### timesheetApprovals

- **Create:** Employee (own, `status='draft'` or `status='submitted'`)
- **Read:** Employee (own), Manager (team), Admin (all)
- **Update:**
  - Employee can submit (`draft` → `submitted`)
  - Manager/Admin can approve/reject (`submitted` → `approved` | `rejected`)
  - Admin can correct (`approved` → `corrected`, with audit log)
- **Delete:** Never

### approvalHistory

- **Create:** System (before state mutations)
- **Read:** Employee (own), Manager (team), Admin (all)
- **Update/Delete:** NEVER (immutable)

## Helper Functions

The following helper functions extend the existing Phase 1 helpers defined in `firestore.rules`:

```
function isEmployee() = hasRole('employee')
function isManager() = hasRole('manager')
function isManagerOrAdmin() = hasRole('manager') || hasRole('admin')
function isAdmin() = hasRole('admin')
function isOwnData(userId) = request.auth.uid == userId
function isActive() = getUserData().active == true
```

## Status Transition Validation

Rules should enforce valid status transitions:

- **leaveRequests:** `pending` → `approved` | `denied` | `cancelled`
- **timesheetApprovals:** `draft` → `submitted` → `approved` | `rejected` → `corrected`

## Audit Requirements

All status changes must:

1. Write to `approvalHistory` BEFORE state mutation
2. Include actor UID, role, timestamp, and notes
3. Capture before/after state snapshots

## Firestore Rules Code

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAuthenticated() {
      return request.auth != null;
    }

    function getUserData() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
    }

    function hasRole(role) {
      return isAuthenticated() && getUserData().role == role;
    }

    function isActive() {
      return isAuthenticated() && getUserData().active == true;
    }

    function isEmployee() {
      return hasRole('employee');
    }

    function isManager() {
      return hasRole('manager');
    }

    function isManagerOrAdmin() {
      return hasRole('manager') || hasRole('admin');
    }

    function isAdmin() {
      return hasRole('admin');
    }

    function isOwnData(userId) {
      return request.auth.uid == userId;
    }

    function isValidStatusTransition(collection, oldStatus, newStatus) {
      return (
        (collection == 'leaveRequests' && (
          (oldStatus == 'pending' && newStatus in ['approved', 'denied', 'cancelled'])
        )) ||
        (collection == 'timesheetApprovals' && (
          (oldStatus == 'draft' && newStatus == 'submitted') ||
          (oldStatus == 'submitted' && newStatus in ['approved', 'rejected']) ||
          (oldStatus == 'approved' && newStatus == 'corrected')
        ))
      );
    }

    match /leaveTypes/{typeId} {
      allow read: if isActive();
      allow create, update: if isAdmin();
      allow delete: if false;
    }

    match /leaveBalances/{balanceId} {
      allow read: if isActive() && (
        isOwnData(resource.data.userId) ||
        isManagerOrAdmin()
      );
      allow create, update: if isAdmin();
      allow delete: if false;
    }

    match /leaveRequests/{requestId} {
      allow create: if isActive() &&
                       isOwnData(request.resource.data.userId) &&
                       request.resource.data.status == 'pending';

      allow read: if isActive() && (
        isOwnData(resource.data.userId) ||
        isManagerOrAdmin()
      );

      allow update: if isActive() && (
        (isOwnData(resource.data.userId) &&
         resource.data.status == 'pending' &&
         request.resource.data.status == 'cancelled') ||
        (isManagerOrAdmin() &&
         resource.data.status == 'pending' &&
         request.resource.data.status in ['approved', 'denied'])
      );

      allow delete: if false;
    }

    match /publicHolidays/{holidayId} {
      allow read: if isActive();
      allow create, update, delete: if isAdmin();
    }

    match /workSchedules/{scheduleId} {
      allow read: if isActive() && (
        isOwnData(resource.data.userId) ||
        isManagerOrAdmin()
      );
      allow create, update: if isAdmin();
      allow delete: if false;
    }

    match /timesheetApprovals/{approvalId} {
      allow create: if isActive() &&
                       isOwnData(request.resource.data.userId) &&
                       request.resource.data.status in ['draft', 'submitted'];

      allow read: if isActive() && (
        isOwnData(resource.data.userId) ||
        isManagerOrAdmin()
      );

      allow update: if isActive() && (
        (isOwnData(resource.data.userId) &&
         resource.data.status == 'draft' &&
         request.resource.data.status == 'submitted') ||
        (isManagerOrAdmin() &&
         resource.data.status == 'submitted' &&
         request.resource.data.status in ['approved', 'rejected']) ||
        (isAdmin() &&
         resource.data.status == 'approved' &&
         request.resource.data.status == 'corrected')
      );

      allow delete: if false;
    }

    match /approvalHistory/{historyId} {
      allow create: if isAuthenticated() &&
                       request.resource.data.actorUid is string &&
                       request.resource.data.actorRole is string &&
                       request.resource.data.timestamp != null &&
                       request.resource.data.action is string;

      allow read: if isActive() && (
        isOwnData(resource.data.targetUserId) ||
        isManagerOrAdmin()
      );

      allow update, delete: if false;
    }
  }
}
```

## Testing Plan

- Unit tests for each collection's rules
- Integration tests for approval workflows
- Edge case tests (concurrent approvals, role changes)
