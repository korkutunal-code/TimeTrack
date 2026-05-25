# TESTING_CHECKLIST.md — Concrete Test Cases for Phase 1 (Punch + Admin Correction + Audit)

**Agent**: QA/Security Agent  
**Derived From**: PROJECT_AUDIT.md, ARCHITECTURE_PLAN, FIRESTORE_DATA_MODEL, SECURITY_RULES_PLAN, existing TIME_INTEGRITY_PLAN and TESTING_GUIDE.

**First Run Note**: This is a planning artifact. No tests were added to the repo during this pass. These cases must be implemented or verified before Phase 1 feature work is considered complete.

---

## 1. Firebase Security Rules — Unit Tests (Priority 1)

Framework: `@firebase/rules-unit-testing` + emulator. File: `tests/rules/time-track-rules.test.ts` (new).

Must-cover scenarios:

### 1.1 Users Collection
- Employee self-provisioning:
  - Can create only own profile with role=employee + active=true.
  - Cannot create profile for another uid.
  - Cannot set role=admin or manager on self-create.
- Admin role can create/update/delete any user profile.
- Manager can read all users, cannot update/delete.
- Inactive user profile blocks re-login (service + test via auth emulator).

### 1.2 timeEntries
- Employee can create only their own entries with userId == auth.uid.
- Employee update limited; cannot flip `status`.
- Employee cannot read/list another employee's timeEntries (list query filtered).
- Manager can read all, cannot write (Phase 1).
- Admin can update timeEntries for correction.
- AFTER Audit trail enforcement: Admin update without corresponding `auditLogs` create in batch → rejected (simulated rule + service test).

### 1.3 auditLogs (NEW)
- Only Admin role can create.
- Create must include non-empty `reason`, `targetCollection: "timeEntries"`, `occurredAt` ≈ request.time.
- No update or delete allowed for any role (including admin).
- Employee can read only audit rows whose `targetId` references their own timeEntries.
- Manager can read any audit row for timeEntries they can already view.

### 1.4 correctionRequests
- Employee creates only with employee_id == own uid.
- Employee cannot update status (only admin can).
- Admin update to Resolved requires non-empty `resolution_note` or `rejection_reason`.
- Cross-check: after resolution, corresponding `auditLogs` row must appear.

### 1.5 systemSettings
- All authenticated users can read `payroll` doc.
- Only admin can write payroll lock doc.

---

## 2. Timezone Enforcement Matrix (Critical)

Location: new `tests/timezone/time-calculations-pt.test.ts`

Cases for every major calculation surface:
- Force `America/Los_Angeles` even when browser reports UTC-5, UTC+1, or DST shifts.
- `workDate` stamping on midnight-crossing punches (e.g., clock-in 11:45pm Sunday PT still Sunday PT date).
- Week boundary calculations for HistoryView and TeamDashboard respect PT week start.
- PayrollReports export uses PT dates consistently regardless of runner timezone.
- DST spring-forward day (March) + fall-back day (November) — verify 23h and 25h days compute correct OT.
- Employee profile `timezone` different from company (e.g., East Coast) never affects payroll minutes (only display).

**Failure Condition**: Any test using raw `new Date()` without explicit PT formatter is a fail.

---

## 3. Punch Clock / Segment State Machine (Clock Agent Deliverables)

New tests in `src/app/components/employee/__tests__/` or top-level services:

- Double clock-in same day (with open segment) → rejected at service + UI toast.
- Clock-out without clock-in → blocked.
- Lunch toggle without prior lunch out → blocked.
- Segment auto-close watchdog after X inactive hours writes `autoClosed: true` and creates audit row.
- Conversion of legacy single flat entry to segments[] works for historical data (hydration idempotent).
- One open segment invariant enforced (cannot have two incomplete segments).

---

## 4. Admin Correction with Mandatory Reason + Audit Log

- Happy path: Admin opens correction dialog, provides non-empty reason, saves → entry updated (`status: "corrected"`, `correctionCount++`), auditLogs row written with exact before/after + reason.
- Sad path: Empty or whitespace-only reason → form disabled + service rejects.
- Admin bypass attempt (direct `updateDoc` via console or script) → either blocked by future hardened rules or immediately visible in audit diff (detect via test emulation).
- Correction on day already containing approved leave → warns + still writes audit record (HR future logic).

---

## 5. Overtime & Flag Engine Regression

- Daily OT >8h @1.5× and >12h @2× calculated and stored in minutes.
- Weekly 40h OT does not double-count daily OT.
- Lunch warnings: <30 min and >90 min correctly flagged and exported.
- Anomaly bypass flag respected.
- Split-shift (two segments same day) correctly rolls up totalWorkMinutes and OT tiers.
- Same test matrix against legacy flat records (migration safety).

---

## 6. Audit Log Immutability Stress Tests

- Attempt to `updateDoc` or `deleteDoc` an auditLogs record via emulator authenticated as admin → rejected.
- Large batch correction (50+ employee days in payroll re-run) produces exactly 50 audit rows atomically.
- Audit row contains full snapshot of segment[] before + after.

---

## 7. Data Migration & Backfill (One-Time Phase 1)

- Existing timeEntries lacking `status` → backfill defaults to `"active"`.
- Existing entries get `timezoneAtCreation` = `"America/Los_Angeles"`.
- Test: Backfill script run on emulator produces consistent segment hydration.

---

## 8. Performance / Scale (Light)

- 500 timeEntries admin report query (current default cap) completes <2s on emulator.
- Employee history for 2 years (≈500 docs) renders without locking UI.
- Concurrent punch from two tabs for same employee → one wins, other shows graceful "already open" error.

---

## 9. CI Pipeline Integration (Future)

Before Clock merge:
- Add GitHub action that:
  1. Starts Firebase emulators.
  2. Runs `npm run test:rules`.
  3. Runs Jest unit + timezone matrix.
  4. Fails PR if coverage on new audit/correction/timeValidation surfaces falls below 80%.

---

## 10. Sign-Off Criteria for Phase 1 QA Pass

- All rule unit tests from section 1 executable and green via `npm test`.
- Every critical timezone edge case in section 2 has passing assertions.
- Punch & correction paths green in manual + unit.
- No tests use unchecked browser `Date` for payroll math.

---

**QA Agent Note**: This checklist is derived directly from threats identified in the live code + the requirements of the master prompt (America/Los_Angeles, mandatory reason, never hard-delete, audit history). It will be updated as Clock and Admin agents complete their features.

Next artifact from this agent: LAUNCH_CHECKLIST.md (final planning deliverable).
