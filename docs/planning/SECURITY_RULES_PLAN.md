# SECURITY_RULES_PLAN.md — Firestore Rules Evolution, RBAC Hardening & Audit Integrity (Design Only)

**Agent**: Architecture Agent  
**Worktree**: architecture/hr-time-structure  
**First-Run**: Pure design artifact. No edits were made to `firestore.rules`, `firestore.indexes.json`, or any security-related source during this run.

---

## 1. Starting Point (From Audit Agent Review)

**Current Rules** (`firestore.rules` v2, ~101 LOC, dated but disciplined):

Strengths:
- Strong self-provisioning guard: Employees can only create their own `users` profile with `role: "employee"` + `active: true`.
- `timeEntries` list restricted to owner via `resource.data.userId == request.auth.uid`.
- Admin-only destructive operations (delete on timeEntries / user updates).
- Correction requests readable by owner + managers/admins; writes limited appropriately.

Gaps (explicitly called out and now architectural requirements):
1. No `auditLogs` collection — therefore no rules for immutable append-only audit trail.
2. Correction reason enforcement is **entirely client-side** (Admin UI). No server enforcement.
3. No explicit `status` field protection (active/corrected/voided/archived) to block accidental direct overwrites via client.
4. No timezone marker contract at rule level.
5. `systemSettings/payroll` allows unauthenticated-role reads (all signed-in) — acceptable for lock date but undocumented intent.
6. No `leaveRequests`, `vacationBalances`, `holidays`, `workPolicies` rules yet (Phase 2 placeholders).

---

## 2. Target Rule Philosophy (Phase 1 + 2)

**Core Invariants (expressed in rules + code + docs):**
- America/Los_Angeles is king — but rules cannot easily enforce "all writes use the same TZ". Instead we mandate client libraries and service layer inject `timezoneAtCreation: "America/Los_Angeles"`.
- Absolute immutability for `auditLogs` — once written, the document may never be updated or deleted except via a separate "compliance export + purge" flow (rare, heavily authorized).
- Every correction **must** carry non-empty `reason` or the write is rejected.
- Soft status model: Documents may only transition via controlled service paths (never in-place admin direct mutation without audit log).
- Defense-in-depth: UI can enforce, but **rules should reject** malformed corrections even if UI is bypassed.

---

## 3. Proposed Rule Structure Evolution (v2 → v3)

Versioning approach: Keep `firestore.rules` as a single file with clear section headers + comments. When we promote to v3, increment the `rules_version` comment and add a top-level "Security Model v3 — Phase 1 Punch & Audit" banner.

### 3.1 New Helper Functions (Recommended Additions)

```javascript
function hasRole(role) { ... } // existing
function isActive() { ... }   // existing

function isAdmin() { return hasRole('admin'); }
function isManager() { return hasRole('manager'); }
function isEmployee() { return hasRole('employee'); }

function isAdminOrManager() { return isAdmin() || isManager(); }

// NEW: Audit log may NEVER be updated or deleted by any role (Phase 1)
function auditLogImmutable() {
  return request.method == 'create' && request.resource.data.occurredAt == request.time;
}

// NEW: Correction reason must be non-empty string, not just whitespace
function hasNonEmptyReason() {
  let reason = request.resource.data.reason;
  return reason is string && reason.trim().size() > 0;
}
```

### 3.2 New `auditLogs` Collection (Critical Phase 1 Addition)

```
match /auditLogs/{logId} {
  // Anyone who can read a time entry can see its audit history (read-through)
  allow read: if isAuthenticated() && (
    hasRole('admin') || hasRole('manager') ||
    (resource != null && exists(/databases/$(database)/documents/timeEntries/$(resource.data.targetId)) && 
     get(/databases/$(database)/documents/timeEntries/$(resource.data.targetId)).data.userId == request.auth.uid)
  );

  // Only creates from trusted service paths (we will encode actor + reason in the service)
  // Rule-level: must be create, must have non-empty reason, and targetCollection is known allow-list
  allow create: if isAuthenticated() && isAdmin() && auditLogImmutable() && hasNonEmptyReason() &&
                  request.resource.data.targetCollection in ['timeEntries', 'leaveRequests'];

  // NO updates, NO deletes for anyone (purging path uses special admin tool later)
  allow update, delete: if false;
}
```

Key enforcement:
- Reason required here at rule granularity.
- `occurredAt` matches server time on create.

### 3.3 Hardened `timeEntries` Rules (Phase 1 Upgrade)

Current rules allow user or admin update. We evolve:

- Employee can create and update **only their own** entries.
- Employee updates restricted to: adding clock/lunch values on their open segment, or creating the initial document. (We will tighten via service.)
- Admin correction path **must** be accompanied by a simultaneous `auditLogs` create in the **same batch** or be rejected. (Firestore rules cannot span transactions easily; this is a service + rules defense-in-depth pair.)

Proposed pseudo-rules language (to be implemented later):

```
match /timeEntries/{entryId} {
  // Read same as before
  allow get: if ...;
  allow list: if ...;

  allow read: if hasRole('manager') || hasRole('admin');

  // Creation: must be self, active, and must stamp required markers
  allow create: if isAuthenticated() && isActive() &&
                  request.resource.data.userId == request.auth.uid &&
                  request.resource.data.workDate matches "^\\d{4}-\\d{2}-\\d{2}$" &&
                  request.resource.data.timezoneAtCreation == "America/Los_Angeles" &&
                  request.resource.data.status in ['active'];

  // Updates:
  // Path A: Employee own entry limited fields (still to be narrowly whitelisted)
  allow update: if isAuthenticated() && isActive() &&
                  request.auth.uid == resource.data.userId &&
                  // only certain field paths allowed — future: use request.writeFields or get-after diff
                  !("status" in request.writeFields) && // employee cannot flip status
                  ...;

  // Path B: Admin correct only via service when audit log is atomically created in same batch (unenforceable in pure rules today)
  // Compromise: allow admin update but **only if** correctionCount increments + lastCorrectedAt is fresh + adminNotes or reason is populated
  allow update: if isAdmin() &&
                  isActive() &&
                  request.resource.data.status in ['active', 'corrected'] &&
                  request.resource.data.adminNotes != null &&
                  request.resource.data.correctionCount > (resource.data.correctionCount ?: 0) &&
                  request.resource.data.lastCorrectedAt != null;
}
```

**Honest limitation**: Firestore security rules cannot atomically create in another collection as part of the same `update` decision easily. This is why the **service layer** (`correctionService.ts` + `auditLogService.ts`) becomes the **true enforcement point**. Rules are the backup.

Recommendation in Phase 1: Service functions (Cloud Functions or trusted client) write the audit row first, then the correction. On client we simulate the double-write via `batch` (acceptable because we control all admin clients initially).

Rules catch the "audit-less admin update" as a fallback.

### 3.4 `users` Rules — Minor Polish (Already Strong)

Add explicit comment block that only the documented creation paths are allowed. Add Phase 2 extension for managers updating their direct reports' limited profile fields (manager_uid, work email, etc. — not role).

### 3.5 `correctionRequests` — Small Hardening

Current: Employees create & read own; admins update status.
Enhance: On status change to Resolved/Rejected:
- Require `resolution_note` or `rejection_reason` depending on outcome.
- Cross-reference to resulting `auditLogs` row (`audit_log_id` field).

---

## 4. Future Phase 2 Leave & HR Collections (Stubs)

These rules are intentionally **read-denied** until Phase 2 architecture is frozen. We stub them now for visibility:

```
match /leaveRequests/{reqId} { allow read, write: if false; } // Phase 2 only
match /vacationBalances/{uid} { allow read: if isAdminOrManager() || request.auth.uid == uid; allow write: if false; }
match /holidays/{doc} { allow read: if isAuthenticated(); allow write: if isAdmin(); }
match /workPolicies/{id} { allow read: if isAuthenticated(); allow write: if isAdmin(); }
```

These stubs are **literally in the rules file** so later HR Agent cannot forget to guard them.

---

## 5. Soft-Delete / Status Protection (Phase 1)

Introduce guarded transitions via rule + service:
- A document can only move `status` from active → corrected via admin path described above.
- Any non-admin attempting to set `status != "active"` on their own entries is rejected.
- Void/archived only via admin + audit row.

---

## 6. Testing Strategy for Rules (Recommended for QA Agent)

- Use existing `test-firestore-rules.js` skeleton + `@firebase/rules-unit-testing`.
- Matrix test cases to write:
  1. Employee cannot update another person's time entry.
  2. Admin cannot correct without writing corresponding audit log row in same batch (simulate).
  3. Non-admin cannot create audit logs.
  4. Audit log created with empty reason → rejected.
  5. User can read back their own audit trail but not other employees' unless manager.
  6. Lock date (`systemSettings/payroll`) is readable by all, writable only by admin.

QA_AGENT must expand this into `TESTING_CHECKLIST.md`.

---

## 7. Rollout & Cutover

1. Architecture freeze (this doc + data model approved).
2. QA reviews proposed rules changes.
3. Manager opens Clock gate → Clock agent may begin `clockService` (which will first trigger the first real rule edits).
4. Rules edit **only** happens on the planning branch after above two gates, via a single carefully reviewed PR (Clock branch may include the rule delta if necessary, but Manager + QA must co-approve).

---

## 8. Non-Goals (Explicitly Out of Scope for Security Posture v1)

- Cross-project Operation Hub data sharing (Phase 3 decision gate).
- Row-level encryption or customer-managed keys at this scale.
- Fine-grained field masking based on role (overkill until +200 employees or regulated industry requirements appear).

---

## 9. Drift & Debt Register (Carry-Forward)

- MUI + lucide icon duplication — cosmetic.
- Legacy `permissions.js` partial duplication of rule intent.
- No current CI job exercising rule tests on every PR.

These will be surfaced again in QA_SECURITY_REVIEW.md.

---

**Architecture Agent Final Declaration (Planning Only)**:
- ZERO production security rules, indexes, or configuration were edited.
- All recommendations above are intended for controlled, gated implementation in later phases after human + manager approval.
- The artifacts in this worktree (`ARCHITECTURE_PLAN.md`, `FIRESTORE_DATA_MODEL.md`, this file) form the complete Phase 0 design triple.

**Ready for HR Agent plan document + subsequent QA agent review.**
