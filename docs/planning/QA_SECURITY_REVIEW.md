# QA_SECURITY_REVIEW.md — Firebase Security, Access Control, Time Integrity, and Deployment Readiness Review

**Agent**: QA/Security Agent  
**Worktree**: qa/testing-security  
**Date**: 2026-05-25  
**Mission**: Read-only comprehensive security & quality assessment. First-run deliverable only. No functional edits performed.

---

## 1. Executive Security Posture

**Overall Assessment (Pre-Phase 1)**:  
TimeTrack has a **reasonably strong starting security posture** for a small-team internal CRUD application — much better than average for a no-backend React+Firebase MVP.

**Critical Blockers for Company-Wide Launch**:
1. **Mandatory correction reason + immutable audit log** does not yet exist in enforcement layer → **High**.
2. **Committed Firebase web keys** with no documented rotation or environment variable override story → **Medium/High**.
3. **Inconsistent timezone handling** (partially fixed in profiling but calculations still browser-local in many paths) → **High** for payroll compliance.
4. **Absence of dedicated `auditLogs` collection + rules** → undermines the "legally defensible" claim already marketed in docs.
5. Thin automated test coverage of rules, correction flows, timezone edge cases, and overtime math.

**Positive Signals**:
- Firestore rules explicitly block self-role-escalation.
- Soft delete direction already discussed in TIME_INTEGRITY_PLAN and notes.
- Strong operational documentation culture.

---

## 2. Firebase Configuration & Secret Management

**File**: `src/config/firebase.config.js`
- All six keys (apiKey through appId) committed in cleartext in git.
- `APP_DOMAIN` is a runtime placeholder ("yourdomain.com").
- No `.env.example` or documented Vite `import.meta.env.VITE_FIREBASE_*` pattern exists at audit time.

**Risk**: Insider threat or repo compromise gives attackers the public API surface — low practical impact because Firebase client keys are publishable, but rotation capability and audit logging of key exposure are absent.

**Recommendation**:
- Add `.env*` patterns and `VITE_FIREBASE_*` mappings immediately in Clock phase.
- Document rotation playbook + last-rotation date.
- Consider moving non-essential keys (messagingSenderId) behind a lightweight config service later.

---

## 3. Authentication Layer Review

**Strengths**:
- Dual provider (email/password + Google) with server profile load every auth state change.
- Inactive profile triggers instant sign-out (good).
- First-time Google auto-provisions as employee only (prevents privilege creep).

**Weaknesses**:
- Password reset flow exists but no forced strong-password policy server-side (Firebase default minimum).
- No account lockout or brute-force observation (Firebase Auth does have some throttling; document it).
- `sms_opt_in` + phone number stored but SMS is not yet wired (future risk surface when notification features activate).

**Action for later**: Consider adding client password entropy check + rate-limit logging in functions after Phase 2.

---

## 4. Firestore Security Rules — Detailed

**Current file**: `firestore.rules` (v2, 101 LOC)

### 4.1 Well-Engineered Areas
- `users` creation restriction: employee self-signup can only ever set role=employee.
- `timeEntries` list hard-bound to uid (excellent).
- Admin-only destructive delete + user management.

### 4.2 Gaps (Matching Architecture Review)
| Gap | Description | Severity | Phase Mitigation |
|-----|-------------|----------|------------------|
| No `auditLogs` collection | Every correction should be non-repudiable. Current admin notes are soft text. | **Critical** | Add in Phase 1, lock immutable at rule level |
| Correction reason not enforced at write time | Client-only. Admin can bypass UI and directly updateDoc with empty or whitespace notes. | **High** | Service + rule require non-empty reason |
| `status` field not yet protected | Anyone who can update an entry can flip status without audit. | High | Rule allows only controlled transitions |
| `systemSettings/payroll` readable by every logged-in user | Intentional for lock date, but undocumented exposure in rules comments. | Low | Document explicitly |
| No Phase-2 stubs hardened | leaveRequests etc. visibly stubbed in Architecture doc but currently allow nothing (good default). | Future | When HR agent enables, rules must be added in same PR |

Full concrete rule language recommendations already written by Architecture Agent into `SECURITY_RULES_PLAN.md`.

---

## 5. Timezone Handling Risks (Critical Payroll Item)

**Current State** (recon from Audit + code reads):
- Profile stores optional `timezone` IANA.
- HistoryView and few utilities use `Intl.DateTimeFormat` for week bounds in employee TZ.
- Core overtime math (`overtimeCalculations.ts`), validation (`timeValidation.ts`), segment mapping, and most flag computations use raw JS `Date` (local browser time).
- Many date keys (`workDate`) are produced as `yyyy-mm-dd` from browser `new Date()` without `en-CA` forcing.
- Hard references to "PST" / California rules exist in docs but not enforced in engine.

**Attack Surface**:
- Employee on East-coast laptop or on travel submits times, causing 3-hour shifted "workDate" and 48h weekly roll-over errors.
- Payroll exports become inconsistent with manager view in California HQ.

**Architecture Mandate** (already stated):
- All logical `workDate`, segment start/end instants, and payroll minutes computed in **America/Los_Angeles**.
- Viewing user timezone used only for display, never for math.
- `timezoneAtCreation` stamped on every time entry and left immutable.

**QA Action Required**: All test cases (see TESTING_CHECKLIST) must include explicit PT scenarios (including DST transitions). Clock Agent must not ship punch screen without strict PT construction helpers + unit test coverage.

---

## 6. Correction Flow & Audit Integrity (Highest-Risk Business Surface)

**Current**:
- CorrectionRequests created by employee with before/after snapshots in the request doc (nice).
- Admin resolves via AdminPanel or CorrectionRequests component → patches `timeEntries` document directly.
- `adminNotes` / `correctionNotes` on the time entry itself is the sole human-readable reason trail.
- No snapshot diff row written to a separate append-only log.
- No enforcement that `resolution_note` is present when admin marks resolved.

**Business Impact**:
- Cannot prove to an employee/auditor/lawyer "exactly what changed on March 12" without relying on human memory or Slack screenshots.
- Violates the "preserve audit history for time changes" global rule in the master prompt.

**Immediate Pre-Phase-1 Fixes (via Clock + Admin agents)**:
1. Create `auditLogs` collection + rules (Architecture already designed).
2. Enforce non-empty reason at the `correctionService` + rule level (dual defense).
3. On any correction write the immutable log row first in a batch, then the time entry update.
4. Store `lastCorrectedAt`, `correctionCount`, `status: 'corrected'`.

This should be **the #1 feature item** in the Clock/Admin workstreams.

---

## 7. Role-Based Access & Privilege Escalation Review

Test cases that must pass (add to CHECKLIST):
- Employee cannot read another employee's time entries (rules + UI).
- Manager cannot update employee time entries or correct others (except via reviewed admin flows if delegated later).
- Admin can correct but the audit log row must succeed.
- Deleted/inactive profile cannot re-authenticate (already works via profile loader).
- First-time Google login can **only** become employee.

Manual verification already performed in auth flow (`auth.ts` + `database.ts`) — appears clean.

---

## 8. Existing Documentation Quality (Compliance & Ops Strength)

**Excellent**:
- `TIME_INTEGRITY_PLAN.md` (357 LOC) — anti-cheat, sequential entry, lunch enforcement, system vs manual timestamping already planned.
- `ONBOARDING_RUNBOOK.md`, `WEEK1_OPERATIONS.md` — extremely practical.
- `TESTING_GUIDE.md` + `FINAL_CHECKLIST.md`
- Multiple deployment & enhancement summaries.

These documents must be treated as living specifications. QA Agent recommends a triennial "paper review" of the integrity plan against actual code behavior after Phase 1 lands.

---

## 9. Testing & Quality Engineering Gaps

Current evidence (package.json + file tree):
- Jest present; only two visible test files (`bulkImportService.test.ts`, `__tests__` limited).
- `test:rules` script exists but references hypothetical `scripts/test-firestore-rules.js`.
- No visible GitHub Actions or CI pipeline exercising tests + emulators on push.
- No snapshot or property-based tests of overtime engine noted.
- No contract tests between client segment model and payroll export shape.

**Concrete Testing Debt** (full matrix in TESTING_CHECKLIST.md):
- 60+ targeted cases recommended for Phase 1.
- Highest priority: rules unit tests using emulator + `@firebase/rules-unit-testing`, DST timezone matrix, audit-log immutability under attempted update/delete, mandatory reason gate.

---

## 10. Deployment & Operational Security

**firebase.json**:
- Hosting rewrites for SPA SNCA correct.
- Emulators configured (auth 9099, firestore 8080, hosting 5000, UI 4000).
- Functions declared but functions/ directory absent (harmless stub).

**Production Domain**: `time.americantiledepot.com` (per docs; requires custom-domain cert management — already done per deployment notes).

**Risk Register**:
- No visible regular backup / export job for Firestore.
- No secrets rotation schedule documented.
- No incident response or roll-back playbook in repo (rely on Firebase console UI).
- Emulator parity with prod indexes/rules currently accidental.

**Pending Pre-Launch Essentials** (detailed in LAUNCH_CHECKLIST.md):
1. Rotate Firebase web keys + document date.
2. Add `.env.example` + actual env provider story.
3. Implement daily/weekly export of critical collections to BigQuery or GCS cold storage (compliance).
4. Produce rollback runbook (git revert + Firestore point-in-time restore or manual document copy).
5. Security headers / CSP review (current hosting headers only do cache-busting).

---

## 11. Privacy / Compliance (Quick)

- No PII beyond work email, phone, name.
- No geolocation, no keystroke logging, no screenshots — in line with "process-based not surveillance" principle in TIME_INTEGRITY_PLAN.
- Audit logs themselves will become PII-adjacent once they contain employee time correction reasons; future DLP policy may apply.

---

## 12. Summary of Required Mitigations Before Phase 1 Completion

| # | Item | Responsible Agent(s) | Must Land Before First Real Payroll on New System |
|---|------|----------------------|---------------------------------------------------|
| 1 | `auditLogs` immutable collection + rules + service | Architecture (design) → Admin Agent | Yes |
| 2 | Mandatory reason enforcement (service + UI + tests) | Admin Agent + QA sign-off | Yes |
| 3 | All time math forced through `America/Los_Angeles` helpers with unit coverage | Clock Agent + utils owner | Yes |
| 4 | Firestore rules unit tests exercising corrections & audit immutability live in repo | QA | Yes (even if skipped in CI initially) |
| 5 | Firebase key rotation + documented | DevOps / Admin | Recommended, not hard blocking |
| 6 | Soft status field on time entries defaults + backfill | Clock or Admin during punch migration | Yes |
| 7 | Correction flow no longer writes direct adminNotes without audit row | Admin | Yes |

---

**QA/Security Agent Declaration (First Run)**: This entire document was produced from read-only analysis. No code, rules, tests, or environment were changed. All findings reference real paths from the 2026-05-25 HEAD plus docs.

**Hand-off**: This review is input to the subsequent TESTING_CHECKLIST.md and LAUNCH_CHECKLIST.md still to be written by this same agent, and to the Manager prior to Clock gate.
