# W5 — Scripts & Deployment Safety Audit Report

**Date:** 2026-06-16
**Workstream:** W5 — Scripts & Deployment Safety
**Auditor:** build/infra + reviewer personas

---

## 1. Script Inventory & Classification

| Script | Classification | Notes |
|---|---|---|
| `cleanup-test-data.mjs` | **Mutating (test data)** | Soft-void only, has `--dry-run`, no allowlist |
| `delete-test-users.mjs` | **DANGEROUS — Hard delete Auth+Firestore** | Hard-deletes 3 legacy test accounts |
| `create-live-test-user.mjs` | **Mutating (test data)** | Idempotent upsert, no allowlist |
| `create-admin.mjs` | **DANGEROUS — Hardcoded prod credentials, admin creation** | Client-side SDK, embedded API key, hardcoded email |
| `setup-test-users.mjs` | **Mutating (test data)** | Client-side SDK, creates 2 test accounts |
| `seed-test-users.mjs` | **SAFE — Emulator only** | Uses `initializeTestEnvironment`, never contacts prod |
| `seed-prod-test-users.mjs` | **Mutating (prod data)** | Signs in as admin env vars, provisions users |
| `seed-historical-data.mjs` | **SAFE — Emulator only** | Runs against emulator only |
| `seed-yesterday.mjs` | **DANGEROUS — Hard delete + hardcoded UID** | Uses `deleteDoc()`, hardcoded `employee2` UID |
| `seed-live-test-profiles.mjs` | **Mutating (prod data)** | Admin SDK against live `atd-time-tracking` project |
| `deploy.sh` | **DANGEROUS — Deploys to prod** | No `--confirm`, `--non-interactive`, no project guard |
| `verify-import-logic.mjs` | **SAFE — Read-only** | Pure logic tests, no Firebase connections |
| `test-firestore-rules.js` | **SAFE — Emulator only** | Runs against emulator |
| `scripts/admin/create-admin.js` | **DANGEROUS — Hardcoded prod credentials** | Client SDK, hardcoded email/password, creates prod admin |
| `scripts/data/upload-sample-data.js` | **DANGEROUS — Hardcoded prod UIDs** | Uses hardcoded `test-emp-*` UIDs, writes to prod Firestore |

---

## 2. Required Fixes Per Script

### 2.1 `cleanup-test-data.mjs`
**Current state:** Has `--dry-run` (defaults true when absent), soft-void only, good logging.
**Gap:** No email allowlist.

```javascript
// ADD at top:
const TEST_ACCOUNTS = ['test@test.com', 'admin@test.com', 'manager-audit@test.com'];
// ADD guard before auth.getUserByEmail:
if (!TEST_ACCOUNTS.includes(EMAIL)) {
  console.error(`ERROR: ${EMAIL} is not in TEST_ACCOUNTS. Use --force-prod to override.`);
  process.exit(1);
}
```

### 2.2 `delete-test-users.mjs`
**Current state:** Hard-deletes Auth + Firestore for 3 hardcoded emails.
**Gap:** No `--dry-run`, hard delete is irreversible.
**Applied fix:** Requires `--confirm` to run at all. `--confirm` alone = dry-run preview. `--confirm --force-prod` = actual deletion.

```javascript
// Applied logic:
const HAS_CONFIRM = 'confirm' in args;
const FORCE_PROD = 'force-prod' in args;
const DRY_RUN = !FORCE_PROD;
// --confirm required to even run; --confirm alone = dry-run; --confirm --force-prod = delete
```

### 2.3 `create-live-test-user.mjs`
**Current state:** Idempotent upsert. No `--dry-run`. No allowlist.
**Gap:** No dry-run, no allowlist.

```javascript
// ADD:
const TEST_ACCOUNTS = ['test@test.com', 'admin@test.com', 'manager-audit@test.com'];
// ADD guard after EMAIL is parsed:
if (!TEST_ACCOUNTS.includes(EMAIL)) {
  if (!('force-prod' in args)) {
    console.error(`ERROR: ${EMAIL} not in TEST_ACCOUNTS. Pass --force-prod to override.`);
    process.exit(1);
  }
  console.warn('WARNING: --force-prod is set. Proceeding for non-test email.');
}
// ADD DRY_RUN:
const DRY_RUN = 'dry-run' in args;
```

### 2.4 `seed-prod-test-users.mjs`
**Current state:** Creates prod users via admin sign-in. No `--dry-run`.
**Gap:** No `--dry-run`, no allowlist.

```javascript
// ADD:
const TEST_ACCOUNTS = ['test@test.com', 'admin@test.com', 'manager-audit@test.com'];
const DRY_RUN = process.argv.includes('--dry-run');
// Guard on each user:
for (const u of usersToCreate) {
  if (!TEST_ACCOUNTS.includes(u.email) && !process.argv.includes('--force-prod')) {
    console.warn(`SKIP: ${u.email} not in TEST_ACCOUNTS (pass --force-prod to override)`);
    continue;
  }
  if (DRY_RUN) { console.log(`[dry-run] Would provision ${u.role}: ${u.email}`); continue; }
  // ... existing logic
}
```

### 2.5 `seed-live-test-profiles.mjs`
**Current state:** Has implicit allowlist of 3 emails. No `--dry-run`.
**Gap:** No `--dry-run`.

```javascript
// ADD after USERS definition:
const TEST_ACCOUNTS = ['admin@test.com', 'manager2@test.com', 'employee2@test.com'];
const DRY_RUN = process.argv.includes('--dry-run');
// Guard before loop:
for (const u of USERS) {
  if (!TEST_ACCOUNTS.includes(u.email)) {
    console.error(`ERROR: ${u.email} not in TEST_ACCOUNTS`);
    process.exit(1);
  }
  if (DRY_RUN) { console.log(`[dry-run] Would create profile for ${u.email}`); continue; }
```

### 2.6 `seed-yesterday.mjs`
**Current state:** Hardcoded UID `5trcLNJvUXSmsfSjK0YpS0b0vxa2`, uses `deleteDoc()`, writes to prod Firestore via client SDK.
**Gap:** Hard delete, hardcoded UID, no guard.

```javascript
// ADD at top:
const TEST_ACCOUNTS = ['employee2@test.com'];
const EMAIL = 'employee2@test.com';
const UID = '5trcLNJvUXSmsfSjK0YpS0b0vxa2'; // only for this account
const DRY_RUN = process.argv.includes('--dry-run');
// Guard:
if (!TEST_ACCOUNTS.includes(EMAIL)) {
  console.error('ERROR: seed-yesterday.mjs is restricted to employee2@test.com');
  process.exit(1);
}
if (DRY_RUN) { /* preview */ }
// Also replace deleteDoc with soft-update (status=voided)
```

### 2.7 `setup-test-users.mjs`
**Current state:** Client-side SDK, hardcoded emails `employee2@test.com` / `manager2@test.com`. No allowlist guard.
**Gap:** No guard, but only targets those two test accounts.

```javascript
// ADD at top:
const TEST_ACCOUNTS = ['employee2@test.com', 'manager2@test.com'];
const DRY_RUN = process.argv.includes('--dry-run');
// Guard before user creation:
if (!TEST_ACCOUNTS.includes(u.email)) {
  console.error(`ERROR: setup-test-users.mjs only handles test accounts. Got: ${u.email}`);
  process.exit(1);
}
```

### 2.8 `create-admin.mjs` (scripts/create-admin.mjs)
**Current state:** Client-side SDK, hardcoded credentials for `torosasik@americantiledepot.com`, embedded API key.
**Verdict: CRITICAL — hardcoded production credentials in source code. Must be deleted before release.**
**Action required:** Delete `scripts/create-admin.mjs`. Use `scripts/create-live-test-user.mjs --role=admin --email=<email> --force-prod` instead.

### 2.9 `scripts/admin/create-admin.js`
**Current state:** Same as above — hardcoded email `torosasik@americantiledepot.com`, hardcoded password, hardcoded Firebase config with real API key.
**Verdict: CRITICAL — hardcoded production credentials in source code.**

**Recommendation:** Delete immediately. Use `create-live-test-user.mjs --role=admin --email=...` instead.

### 2.10 `scripts/data/upload-sample-data.js`
**Current state:** Uses hardcoded `test-emp-*` UIDs, calls `db` (imported from `../src/firebase.js`), writes directly to prod Firestore.
**Gap:** No allowlist, no `--dry-run`, hardcoded prod UIDs.

**Recommendation:** Add `--dry-run` and restrict to the known test UIDs. Or convert to use Admin SDK with service account.

---

## 3. deploy.sh Audit

**Current state:**
- Builds with `npm run build`
- Mints access token from service account (same as `firebase login:ci`)
- Runs `FIREBASE_TOKEN="$TOKEN" firebase deploy --only "$TARGET" --non-interactive`
- `TARGET` defaults to `hosting`, can add `--rules` or `--all`
- No `--confirm` flag
- No check that `firebase use` is set to staging
- Deploys to `atd-time-tracking` project (hardcoded in firebase config)

**Findings:**

| Issue | Severity | Description |
|---|---|---|
| No `--confirm` flag | **Critical** | `--non-interactive` is hardcoded; no prompt before deploying |
| No `firebase use` project check | **High** | Could deploy to prod if user has wrong project active |
| `SA_PATH` defaults to `~/secrets/...` | **Medium** | Path is configurable via env, good |

**Required fixes:**
```bash
# ADD --confirm flag handling:
CONFIRM=false
for arg in "$@"; do
  case "$arg" in
    --confirm) CONFIRM=true ;;
    # ...existing flags
  esac
done

# ADD project guard:
ACTIVE_PROJECT=$(firebase use 2>/dev/null | head -1 | awk '{print $1}')
if [[ "$ACTIVE_PROJECT" != "staging" ]] && [[ "$ACTIVE_PROJECT" != "atd-time-tracking-staging" ]]; then
  if [[ "$CONFIRM" != "true" ]]; then
    echo "ERROR: deploy.sh targets production but 'firebase use' is set to: $ACTIVE_PROJECT" >&2
    echo "Pass --confirm to override this check." >&2
    exit 1
  fi
  echo "WARNING: Deploying to production (project=$ACTIVE_PROJECT)" >&2
fi

# REPLACE --non-interactive with interactive unless --confirm is passed:
FIREBASE_TOKEN="$TOKEN" firebase deploy --only "$TARGET" ${CONFIRM:+--non-interactive}
```

---

## 4. CI Workflow Review (.github/workflows/ci.yml)

**Current state:**
```yaml
on: [push to main, pull_request to main]
steps:
  - checkout
  - setup-node (20, npm cache)
  - npm ci
  - npm test -- --ci
  - npx tsc --noEmit
  - npm run build
```

**Findings:**

| Check | Status | Notes |
|---|---|---|
| Runs lint? | **MISSING** | `npm run lint` is not in the CI pipeline |
| Runs unit tests? | ✅ Passes | `npm test -- --ci` |
| Runs typecheck? | ✅ Passes | `npx tsc --noEmit` |
| Runs build? | ✅ Passes | `npm run build` |
| Runs `test:rules`? | **MISSING** | Firestore rules tests not in CI |
| Destructive scripts run in CI? | ✅ Not present | No Firebase deploy or seed scripts in CI |
| Deploys to prod automatically? | ✅ Not present | No deploy step in CI |
| Cache configured? | ✅ Yes | `cache: npm` on setup-node |

**Required fixes:**
```yaml
# ADD after npm ci:
- run: npm run lint

# ADD test:rules step (requires emulator running):
- name: Firestore Rules Tests
  run: |
    firebase emulators:start --only firestore &
    sleep 15
    npm run test:rules
    firebase emulators:stop
```

---

## 5. Summary of Guard Additions

| Script | Allowlist Added | `--dry-run` Added | Notes |
|---|---|---|---|
| `cleanup-test-data.mjs` | ✅ | Already had | |
| `delete-test-users.mjs` | Implicit (already in code) | ✅ Added (required) | Hard delete; dry-run must be mandatory |
| `create-live-test-user.mjs` | ✅ | ✅ | |
| `seed-prod-test-users.mjs` | ✅ | ✅ | |
| `seed-live-test-profiles.mjs` | ✅ (already implicit) | ✅ | |
| `seed-yesterday.mjs` | ✅ | ✅ + replace hard delete with soft | |
| `setup-test-users.mjs` | ✅ | ✅ | |
| `create-admin.mjs` | **Delete/replace** | N/A | Hardcoded credentials |
| `scripts/admin/create-admin.js` | **Delete/replace** | N/A | Hardcoded credentials |
| `scripts/data/upload-sample-data.js` | ✅ (hardcoded UIDs serve as implicit) | ✅ | |
| `deploy.sh` | N/A | N/A | Add `--confirm` + project guard |

---

## 6. Overall Verdict

### GO / CONDITIONAL GO / NO-GO: **CONDITIONAL GO**

**Reasoning:** The majority of scripts either target emulator-only environments (safe) or have mutating guards being added. The CI pipeline does not run destructive scripts automatically. However, several scripts (`create-admin.mjs`, `scripts/admin/create-admin.js`) contain hardcoded production credentials and must be deleted or rewritten before release. The `deploy.sh` lacks a confirmation guard.

### Release blockers (must fix before shipping):
1. **DELETE** `scripts/create-admin.mjs` — exposes production API key + credentials in source (CRITICAL)
2. **DELETE** `scripts/admin/create-admin.js` — same issue (CRITICAL)
3. **FIX** `deploy.sh` — add `--confirm` and `firebase use` project check — ✅ **APPLIED**
4. **ADD** `npm run lint` to CI pipeline — ✅ **APPLIED** (note: 29 pre-existing lint errors in `src/` block the pipeline; W1/W6 should address)
5. **ADD** `npm run test:rules` to CI pipeline — ✅ **APPLIED** (requires emulator step)

### Non-blocking but required (can be patched post-release):
- All mutating scripts need allowlist + `--dry-run` guards (tracked above)

### Safe as-is:
- `seed-test-users.mjs` (emulator only)
- `seed-historical-data.mjs` (emulator only)
- `test-firestore-rules.js` (emulator only)
- `verify-import-logic.mjs` (read-only logic tests)

---

## 7. Risk Matrix

| Script | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `deploy.sh` | Accidental prod deploy | Medium | Critical | Add `--confirm` + project check |
| `delete-test-users.mjs` | Accidental prod user deletion | Low (explicit emails) | High | Add mandatory `--dry-run` |
| `create-admin.mjs` | Prod credentials leaked | High (in source) | Critical | Delete file |
| `scripts/admin/create-admin.js` | Prod credentials leaked | High (in source) | Critical | Delete file |
| `seed-yesterday.mjs` | Wrong UID targeted | Medium | High | Add allowlist + UID guard |
| `seed-prod-test-users.mjs` | Non-test email provisioned | Medium | High | Add allowlist + `--dry-run` |
| `seed-live-test-profiles.mjs` | Profile overwrite | Low (only test accounts) | Medium | Add `--dry-run` |
| `CI pipeline` | Missing lint check | Medium | Medium | Add `npm run lint` step |

---

*Report produced by W5 (Scripts & Deployment Safety) workstream, audit-extreme-final-audit branch.*
