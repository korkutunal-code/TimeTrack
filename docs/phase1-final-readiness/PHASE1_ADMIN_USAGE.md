# Phase 1 Admin Usage Guide

## How to Review Weekly Timesheets

1. Log in as an admin or manager.
2. Navigate to the **Admin** tab (admins) or **Team** tab (managers).
3. The **Weekly Timesheet Review** panel shows all employee time entries.
4. Use filters to narrow results:
   - **Start/End Date**: Default is last 7 days.
   - **Employee**: Filter by specific employee or view all.
   - **Status**: Filter by Active, Corrected, or Incomplete entries.
5. Click **Apply Filters** and then **Refresh** to load data.

## How to Correct Entries

1. In the Admin panel, click **Correct Entry**.
2. Select the employee and date, then click **Load Entry**.
3. The current entry data is displayed with editable fields.
4. Modify Clock In, Clock Out, Lunch Out, and Lunch In times as needed.
5. A **Preview Changes** section shows before/after total hours.
6. **Enter Admin Notes** (required) — explain the reason for the correction.
7. Click **Save Correction**.

### Mandatory Reason Rule

- Admin Notes **cannot be empty**. The Save button is disabled until notes are provided.
- The reason is stored in the immutable audit log and on the corrected time entry.
- This is enforced at three levels:
  1. **UI**: Button disabled when notes are empty.
  2. **Service**: `auditLogService` rejects empty reasons.
  3. **Firestore Rules**: Audit log entries require non-empty `reason` field.

## Audit Log Behavior

- Every correction creates an **immutable audit log entry** in the `auditLogs` collection.
- The audit log contains:
  - Actor (who made the correction)
  - Timestamp
  - Before/after snapshots of the time entry
  - Reason for correction
  - Target entry ID
- Audit logs **cannot be modified or deleted** by any user (enforced by Firestore rules).
- Audit logs are visible to admins and managers in the **Audit** tab.

## Export Notes

- **Weekly Timesheet CSV**: Export filtered timesheet data from the review panel.
  - Filename: `admin-weekly-timesheet-YYYY-MM-DD-to-YYYY-MM-DD.csv`
  - Contains: Date, Employee, Clock In, Clock Out, Hours, Status, Flags
  - This is a **separate export** from the payroll CSV — it does not overwrite or interfere with payroll reports.
- **Payroll Reports**: Available in the Payroll tab — uses the original payroll export format.

## Correction Requests Tab

- The **Corrections** tab shows employee-submitted correction requests.
- Admins can:
  - View all requests with status (Open, In Progress, Resolved, Rejected).
  - Update request status and add resolution notes.
  - Resolution notes are required before saving.

## What Admin Should NOT Do

1. **Do not hard-delete time entries** — use corrections with status changes instead.
2. **Do not skip the reason field** — the system enforces this, but do not attempt workarounds.
3. **Do not modify audit logs** — they are immutable by design and Firestore rules prevent it.
4. **Do not share admin credentials** — all corrections are attributed to the acting admin.
5. **Do not correct entries in locked payroll periods** — check the Payroll Lock Date in System Settings first.
6. **Do not use the weekly CSV export as a payroll substitute** — use the Payroll tab for official payroll processing.
