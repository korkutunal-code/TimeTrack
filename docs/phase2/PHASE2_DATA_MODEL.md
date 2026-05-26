# Phase 2 Data Model

**Date:** 2026-05-25  
**Status:** Draft

---

## Overview

Phase 2 introduces seven new Firestore collections to support leave management, public holidays, work schedules, and timesheet approval workflows.

---

## Collections

### 1. leaveTypes

**Purpose:** Define categories of time off

```typescript
interface LeaveType {
  id: string;               // e.g., "vacation", "sick", "unpaid"
  name: string;             // Display name
  color: string;            // Hex color for calendar display
  accrualEnabled: boolean;  // Future: auto-accrual
  maxDaysPerYear?: number;  // Optional annual limit
  requiresReason: boolean;  // Whether request needs explanation
  paid: boolean;            // Whether leave is paid
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;        // Admin UID
}
```

**Default Types:**
- Vacation (paid, accrual)
- Sick (paid, no accrual)
- Unpaid (unpaid, no accrual)
- Bereavement (paid, no accrual)
- Jury Duty (paid, no accrual)

---

### 2. leaveBalances

**Purpose:** Track available leave per employee per type

```typescript
interface LeaveBalance {
  id: string;               // Format: userId_leaveTypeId
  userId: string;
  leaveTypeId: string;
  openingBalance: number;   // Days at start of year
  accrued: number;          // Days accrued (future)
  used: number;             // Days used
  pending: number;          // Days in pending requests
  available: number;        // openingBalance + accrued - used - pending
  year: number;             // Calendar year
  lastUpdated: Timestamp;
  updatedBy: string;        // Admin UID for manual adjustments
}
```

**Calculation:**
```
available = openingBalance + accrued - used - pending
```

**Notes:**
- Updated on leave request creation (pending++)
- Updated on leave approval (pending--, used++)
- Updated on leave denial (pending--)
- Updated on leave cancellation (used-- or pending--)

---

### 3. leaveRequests

**Purpose:** Employee time off requests

```typescript
interface LeaveRequest {
  id: string;               // Auto-generated
  userId: string;
  leaveTypeId: string;
  startDate: string;        // YYYY-MM-DD
  endDate: string;          // YYYY-MM-DD
  days: number;             // Calculated work days in range
  reason?: string;          // Optional explanation
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  
  // Approval metadata
  reviewedBy?: string;      // Manager/Admin UID
  reviewedAt?: Timestamp;
  reviewNotes?: string;     // Reason for approval/denial
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Status Transitions:**
```
pending → approved (manager/admin)
pending → denied (manager/admin)
pending → cancelled (employee)
approved → cancelled (employee, with admin approval)
```

**Validation:**
- startDate <= endDate
- days > 0
- No overlapping approved requests
- Sufficient balance (for paid leave types)

---

### 4. publicHolidays

**Purpose:** Company-wide non-working days

```typescript
interface PublicHoliday {
  id: string;               // Format: YYYY-MM-DD or recurring_month_day
  date: string;             // YYYY-MM-DD (specific) or MM-DD (recurring)
  name: string;             // e.g., "New Year's Day"
  recurring: boolean;       // Whether holiday repeats annually
  timezone: string;         // "America/Los_Angeles"
  createdAt: Timestamp;
  createdBy: string;        // Admin UID
}
```

**Examples:**
- New Year's Day (Jan 1, recurring)
- Independence Day (Jul 4, recurring)
- Company Anniversary (specific date, non-recurring)

---

### 5. workSchedules

**Purpose:** Define expected work patterns per employee

```typescript
interface WorkSchedule {
  id: string;               // Format: userId or "default"
  userId?: string;          // null for company default
  daysOfWeek: number[];     // 0=Sun, 1=Mon, ..., 6=Sat
  hoursPerDay: number;      // Expected hours per work day
  timezone: string;         // "America/Los_Angeles"
  effectiveFrom: string;    // YYYY-MM-DD
  effectiveTo?: string;     // YYYY-MM-DD (null = ongoing)
  createdAt: Timestamp;
  updatedAt: Timestamp;
  updatedBy: string;        // Admin UID
}
```

**Default Schedule:**
```typescript
{
  daysOfWeek: [1, 2, 3, 4, 5],  // Mon-Fri
  hoursPerDay: 8,
  timezone: "America/Los_Angeles"
}
```

---

### 6. timesheetApprovals

**Purpose:** Weekly timesheet approval records

```typescript
interface TimesheetApproval {
  id: string;               // Format: userId_YYYY-MM-DD (week start)
  userId: string;
  weekStart: string;        // YYYY-MM-DD (Monday)
  weekEnd: string;          // YYYY-MM-DD (Sunday)
  totalHours: number;       // Sum of approved hours
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'corrected';
  
  // Submission metadata
  submittedAt?: Timestamp;
  submittedBy?: string;     // Employee UID
  
  // Approval metadata
  approvedBy?: string;      // Manager/Admin UID
  approvedAt?: Timestamp;
  approvalNotes?: string;
  
  // Correction metadata
  correctedBy?: string;     // Admin UID
  correctedAt?: Timestamp;
  correctionReason?: string;
  
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

**Status Transitions:**
```
draft → submitted (employee)
submitted → approved (manager/admin)
submitted → rejected (manager/admin, with reason)
approved → corrected (admin, with reason and audit log)
rejected → submitted (employee, after corrections)
```

---

### 7. approvalHistory

**Purpose:** Immutable audit trail for all approval actions

```typescript
interface ApprovalHistory {
  id: string;               // Auto-generated
  approvalId: string;       // timesheetApprovals or leaveRequests ID
  approvalType: 'timesheet' | 'leave';
  action: 'submitted' | 'approved' | 'rejected' | 'corrected' | 'cancelled';
  actorUid: string;         // Who performed the action
  actorRole: 'employee' | 'manager' | 'admin';
  timestamp: Timestamp;
  notes?: string;           // Reason or comments
  
  // Snapshot of state before action
  before: Record<string, any>;
  after: Record<string, any>;
}
```

**Rules:**
- Append-only (no updates or deletes)
- Created before state mutation
- Required for all status transitions

---

## Indexes

### Composite Indexes Required

```javascript
// Leave requests by user and status
collection: leaveRequests
fields: [userId ASC, status ASC, startDate DESC]

// Leave requests by reviewer
collection: leaveRequests
fields: [status ASC, createdAt DESC]

// Timesheet approvals by user and week
collection: timesheetApprovals
fields: [userId ASC, weekStart DESC]

// Timesheet approvals by status
collection: timesheetApprovals
fields: [status ASC, weekStart DESC]

// Approval history by approval
collection: approvalHistory
fields: [approvalId ASC, timestamp DESC]
```

---

## Relationships

```
users (existing)
  ├─ leaveBalances (1:many)
  ├─ leaveRequests (1:many)
  ├─ workSchedules (1:many, effective date ranges)
  └─ timesheetApprovals (1:many)

leaveTypes
  ├─ leaveBalances (1:many)
  └─ leaveRequests (1:many)

timesheetApprovals
  └─ approvalHistory (1:many)

leaveRequests
  └─ approvalHistory (1:many)
```

---

## Migration Strategy

### Phase 2A (Foundation)
1. Create `leaveTypes` with default types
2. Create `publicHolidays` with US federal holidays
3. Create default `workSchedules` for all employees

### Phase 2B (Leave Requests)
1. Initialize `leaveBalances` for all employees
2. Enable `leaveRequests` creation

### Phase 2C (Timesheet Approval)
1. Create `timesheetApprovals` for current week
2. Enable submission workflow

---

## Security Considerations

1. **Field-level validation**: All required fields enforced in rules
2. **Status transitions**: Only valid transitions allowed
3. **Audit trail**: All mutations logged to approvalHistory
4. **Timezone integrity**: All dates stored in America/Los_Angeles
5. **Soft deletes**: Use status='cancelled', never delete documents

---

*Document generated by Overnight Manager Agent*
