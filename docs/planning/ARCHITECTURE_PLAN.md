# ARCHITECTURE_PLAN.md — Future HR & Employee Time Tracking Architecture (Firebase Native)

**Agent**: Architecture Agent  
**Worktree**: architecture/hr-time-structure  
**First-Run Constraint**: This is a design-only deliverable. Zero code edits to src/, rules, or config.

## 1. Guiding Principles (Non-Negotiable)
- **Firebase-first / Google Cloud native** for the foreseeable horizon. No PHP, no monolith migration.
- **Employee attendance & HR records only** — no client billing, no project budgeting, no invoicing.
- **America/Los_Angeles (PT/PST/PDT)** = canonical company timezone for all calculations, storage, display, exports. Per-employee `timezone` field remains for display preference but does not alter payroll math.
- **Soft-delete / status immutability**: Every time record has `status: 'active' | 'corrected' | 'voided' | 'archived'`. Never `delete()`.
- **Mandatory reason + signed audit trail** for every human-initiated or system correction.
- **Phase isolation**: Phase 1 = get clock + correction audit trail right. Later phases add HR leave without retroactive breakage.
- Preserve and evolve the existing excellent split-shift segment model rather than discarding it.

## 2. High-Level System Layers (Target State Post-Phase 2)

```
UI Layer (React)
  ├── Employee: Punch/Clock (new) + Today/Week Review
  ├── Manager: Team View + lightweight approvals
  └── Admin: Review, Correct (enforced reason), Payroll, Audit, Patterns, Bulk

Service / Business Rules (TS utils + thin service layer)
  ├── clockService.ts (new, Clock Agent owns)
  ├── correctionService.ts + auditLogService.ts (Admin owns with Architecture oversight)
  ├── timeValidation.ts & overtimeCalculations.ts (tighten, centralize)
  └── leaveService.ts + holidayService (Phase 2 / HR)

Persistence (Firestore)
  ├── Existing evolved collections (see FIRESTORE_DATA_MODEL.md)
  └── New protected collections: auditLogs, vacationBalances, leaveRequests, holidays, workPolicies

Security
  ├── firestore.rules v3 (see SECURITY_RULES_PLAN.md)
  └── Future: optional lightweight Cloud Functions for async payroll exports / daily cron (Phase 3+)

Observability (future)
  - Aggregated daily payroll snapshots (materialized, read-only for auditors)
```

## 3. Key Architecture Decisions

### 3.1 Punch vs. Manual Entry
- Introduction of a true single-action punch clock (mobile-optimized) for clock-in/out + optional lunch toggle.
- Preserves the ability for manual entry/correction for edge cases.
- Punch creates one `segments[]` row per session in real time; legacy step form can be deprecated later.
- Single open segment per employee per day max; prevents accidental double-punch via optimistic lock + Firestore transaction.

### 3.2 Correction & Audit Trail (Phase 1 Critical Path)
- Every correction (Admin or via employee request workflow) MUST:
  1. Write an immutable `auditLogs` entry (before/after, actor uid, reason text, timestamp, entryId).
  2. Update the `timeEntries` document status → `corrected`.
  3. Never overwrite original segment values (append delta).
- This satisfies both internal compliance and legal defensibility.

### 3.3 Leave, Holidays, Work Policy (Phase 2)
- Separate but joinable collections.
- Each employee has a `vacationBalances` doc summarizing accrued/used.
- `leaveRequests` carry `status`, `approvalChain`, related `auditLogs`.
- `holidays` = company-wide + location overrides (US federal + CA state + company-specific).
- `workPolicies` document defines per-role or per-department expected hours/week + overtime thresholds (allows graceful extension beyond pure CA rules later).

### 3.4 Timezone Handling
- **Storage**: All `workedDate`, `eventTs`, segment times stored in `America/Los_Angeles`.
- **Display**: Convert to the viewing user’s profile `timezone` (with explicit label “Company Time” indicator).
- Calculations never use browser `Date` directly without forced `Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles'})`.

### 3.5 Data Ownership & Future Operation Hub Integration (Phase 3)
- TimeTrack is a service-of-record for attendance.
- In Phase 3 we define a narrow export surface (`/api/attendance/export` or webhook push) + eventual shared login surface (Auth custom claims or token exchange). Database merge is explicitly disallowed until legal, security, and capacity review.

## 4. Phasing Strategy (Summary)

| Phase | Focus | Major New Artifacts | Risk Level |
|-------|-------|---------------------|------------|
| 1 | Punch clock + admin correction audit trail | `clockService`, `auditLogs` collection + rules, mandatory reason UI/service | Medium |
| 2 | Full leave/holiday/work-policy module | `leaveRequests`, `holidays`, `vacationBalances`, `workPolicies`, approval flows | Medium |
| 3 | Operation Hub integration | Narrow export API surface, shared/navbar, eventual cross-app SSO discussion | High |

## 5. Technology Upgrade Path (Low Risk)

- Add `src/services/clockService.ts` (thin wrapper around Firestore transactions for punch atomicity).
- Add `src/services/auditLogService.ts` (pure writes + small query helpers; owned by Admin but shaped by Architecture).
- Consider introducing TanStack Query or a lightweight repository pattern for optimistic UI once feature work accelerates — avoid premature abstraction now.
- Linting: Add `.eslintrc` + `npm run lint` script if absent (currently Aus audit surfaced possible gap).
- Testing: Expand Jest + add Firebase rules unit tests early in Phase 1.

## 6. Documentation Tie-Ins

This document is the parent to:
- FIRESTORE_DATA_MODEL.md (collections, states, indexes)
- SECURITY_RULES_PLAN.md (RBAC + immutable guarantees)

All three are required reading for Clock, Admin, HR, and QA agents before any code branch activation after this gate.

---

**Architecture Agent Declaration**: No production artifacts were altered. This is a pure technical design document grounded in the patterns discovered by the Audit Agent in the live codebase.

**Next Gate**: Await human + Manager approval to allow simulation of QA agent start.
