# TimeTrack Rule: Mandatory Audit Reason on Every Correction

**Applies to:** Any change that modifies historical time data (corrections, admin edits, bulk imports, etc.).

## Mandatory Rule
- Every correction to a time record **MUST** produce an immutable entry in the `auditLogs` collection.
- The correction **MUST** include a non-empty, human-provided `reason`.
- No path may bypass this (including future admin UIs, import scripts, or direct Firestore writes in tests).

## Verification Checklist
- [ ] The correction flow writes to `auditLogs` with the exact reason supplied by the user.
- [ ] There is no "silent correction" or "adminNotes only" path that skips the audit log.
- [ ] Tests cover the audit entry creation.

**Reference:** AGENTS.md line 37 ("Audit Requirement")
