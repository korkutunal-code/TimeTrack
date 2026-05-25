# Legacy Delete Path Review

**Date**: 2026-05-25
**Branch**: fix/remove-legacy-hard-delete-paths

## Findings

### 1. TeamDashboard.tsx — `handleDeleteEntry` (now `handleVoidEntry`)

**Original**: Used `deleteDoc()` to permanently remove time entries from Firestore.
**Risk**: Irreversible data loss, no audit trail, violates soft-deletion policy.
**Fix**: Replaced with status-based voiding:
- Prompts admin/manager for mandatory reason
- Writes immutable audit log via `auditLogService.logVoidEntry()` BEFORE mutation
- Sets `status: 'voided'` with `voidedAt`, `voidedBy`, `voidReason` metadata
- Record preserved in Firestore for audit/payroll recovery

### 2. TodayEntry.tsx — `resetToday` (test mode only)

**Original**: Used `deleteDoc()` to permanently remove today's entry.
**Risk**: Even in test mode, hard delete is dangerous. Could be triggered accidentally.
**Fix**: Replaced with status-based voiding:
- Uses `auditLogService.logVoidEntry()` with `actorRole: 'system'`
- Sets `status: 'voided'` with full metadata
- Still gated behind `VITE_TEST_MODE === 'true'`

### 3. database.ts:439 and authService.ts:232 — `deleteDoc` on users collection

**Status**: NOT MODIFIED
**Reason**: These delete user profile documents, not time entries. User management
deletions are outside the scope of the time-record soft-deletion policy.

## Additional Fixes

- Removed duplicate `auditLogService` imports in both files
- Fixed `user.displayName` → `user.name` to match User interface
- Added `logVoidEntry()` method to `AuditLogService` with `action: 'void_entry'`

## Checks

| Check | Result |
|-------|--------|
| TypeScript | PASS |
| Build | PASS |
| Tests | PASS (11/11) |

## Remaining Risks

- `window.prompt()` for reason is functional but not ideal UX — could be replaced with a modal dialog in a future iteration
- Firestore rules for `auditLogs` collection use `action: 'time_correction'` validation — the new `void_entry` action type should be verified against rules
