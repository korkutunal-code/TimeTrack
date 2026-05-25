# TimeTrack - AI Agent Instructions

Welcome to the **TimeTrack** codebase. This document helps AI agents understand the project structure, conventions, and operational requirements.

## 🚀 Quick References

- **Primary Stack**: React (Vite), Firebase (Auth, Firestore, Hosting), Tailwind CSS.
- **Core Domain**: Employee attendance and HR records only. No client billing or project budgeting.
- **Canonical Timezone**: `America/Los_Angeles` (PT/PST/PDT) for all payroll math and storage.

## 🛠 Commands

| Action | Command |
| :--- | :--- |
| **Development** | `npm run dev` (also `npm start`) |
| **Build** | `npm run build` |
| **Lint** | `npm run lint` |
| **Test (Jest)** | `npm run test` |
| **Test (Firestore Rules)** | `npm run test:rules` |
| **Seed Test Users** | `npm run seed:test-users` |
| **Seed Prod Test Users** | `npm run seed:prod-test-users` |
| **Deploy** | `firebase deploy` (CLI installed globally) |
| **Deploy rules only** | `firebase deploy --only firestore:rules,firestore:indexes` |

## 🏗 Architecture & Conventions

### 1. Project Organization
- `src/app/components/`: Component hierarchy split by role (`admin/`, `employee/`, `manager/`) and `ui/` for shared Radix-based components.
- `src/services/`: Core business logic (auth, import/export).
- `src/utils/`: Critical calculation helpers (overtime, time strings, date helpers).
- `docs/`: Master documentation. **Read before large changes.**

### 2. Guardrails (Non-Negotiable)
- **Timezone Integrity**: Never use browser `Date` directly for payroll calculations. Use `Intl.DateTimeFormat` or helpers in `src/utils/dateHelpers.js` forced to `America/Los_Angeles`.
- **Soft Deletions**: Never call `.delete()` on Firestore documents. Use `status: 'voided' | 'archived'`.
- **Audit Requirement**: Every correction to a time record must produce an immutable entry in the `auditLogs` collection including a mandatory reason.
- **Role-Based Access**: Permissions are enforced via `src/utils/permissions.js` and `firestore.rules`.
- **California Overtime**: Calculations follow specific CA rules (8h daily OT, 12h daily DT, 40h weekly OT). See [overtimeCalculations.ts](src/utils/overtimeCalculations.ts).

### 3. Key Files to Refer To
- [ARCHITECTURE_PLAN.md](docs/planning/ARCHITECTURE_PLAN.md): High-level system design.
- [FIREBASE_DATA_MODEL.md](docs/planning/FIRESTORE_DATA_MODEL.md): Canonical collection shapes and indexes.
- [SECURITY_RULES_PLAN.md](docs/planning/SECURITY_RULES_PLAN.md): Security and RBAC principles.
- [overtimeCalculations.ts](src/utils/overtimeCalculations.ts): Logic for California overtime.
- [timeCalculations.ts](src/utils/timeCalculations.ts): Total hours and segment math.
- [dateHelpers.js](src/utils/dateHelpers.js): Centralized PT conversion logic.

## ⚠️ Pitfalls
- **Split-Shift Segments**: Time entries use a `segments[]` model to handle lunch breaks and multiple sessions. Ensure logic handles arrays of segments.
- **Firestore Rules**: Changing Firestore structure often requires updating `firestore.rules`. Always run `npm run test:rules` after such changes.
- **Vite/Tailwind**: Uses Tailwind v4 with the `@tailwindcss/vite` plugin. CSS is managed in `src/app/styles/`.
- **Firebase Initialization**: Firebase is initialized in `src/lib/firebase.ts` using config from `src/config/firebase.config.js`. Proxy exports in `src/firebase.js` (legacy) may still exist.
- **Dragme Integration**: `src/services/dragmeService.ts` is an optional external task-sync service. Requires `VITE_DRAGME_API_URL` and `VITE_DRAGME_API_KEY` env vars. All methods silently no-op when unconfigured — do not add hard failures.
- **Linting**: `eslint.config.mjs` uses flat config (ESLint v9). Run `npm run lint` before commits.

## 📚 Documentation Index
- [Onboarding Runbook](docs/guides/ONBOARDING_RUNBOOK.md)
- [California Overtime Guide](docs/guides/CALIFORNIA_OVERTIME_SYSTEM.md)
- [Testing Guide](docs/testing/TESTING_GUIDE.md)
- [Deployment Guide](docs/deployment/DEPLOYMENT_GUIDE.md)
