# Phase 1 Staging Readiness

## Status: READY

Phase 1 (Clock + Admin integration) is ready for staging deployment. All automated checks pass, business rules are verified, and no Phase 2 features have been introduced.

## Required Firebase Project / Env Setup

1. **Firebase project**: Ensure the staging Firebase project is configured with:
   - Firestore database enabled
   - Firebase Authentication enabled (Email/Password provider)
   - Firebase Hosting configured (if deploying frontend)

2. **Environment variables** (`.env` or `.env.staging`):
   ```
   VITE_FIREBASE_API_KEY=<staging-api-key>
   VITE_FIREBASE_AUTH_DOMAIN=<staging-auth-domain>
   VITE_FIREBASE_PROJECT_ID=<staging-project-id>
   VITE_FIREBASE_STORAGE_BUCKET=<staging-storage-bucket>
   VITE_FIREBASE_MESSAGING_SENDER_ID=<staging-sender-id>
   VITE_FIREBASE_APP_ID=<staging-app-id>
   ```

3. **Optional** (not required for Phase 1):
   ```
   VITE_DRAGME_API_URL=<dragme-api-url>
   VITE_DRAGME_API_KEY=<dragme-api-key>
   VITE_TEST_MODE=false
   VITE_USE_EMULATORS=false
   ```

## Required Manual Checks

Before deploying to staging, verify:

1. Firebase staging project credentials are configured.
2. At least one admin user exists in the staging Firestore `users` collection.
3. Firestore indexes are deployed (`firebase deploy --only firestore:indexes`).
4. Firestore rules are deployed (`firebase deploy --only firestore:rules`).

## Known Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Firestore rules not tested with emulator | Medium | Deploy rules to staging and test manually with admin/employee accounts |
| Mobile punch UX untested on real devices | Low | Test on iOS Safari and Android Chrome during staging |
| No lint script in package.json | Low | Add `lint` script before Phase 2; ESLint config exists |
| Dragme integration untested | Low | All methods no-op when unconfigured; test only if env vars are set |

## Staging Deploy Steps

```bash
# 1. Checkout the staging branch
git checkout ready/phase1-staging

# 2. Install dependencies
npm install

# 3. Build the production bundle
npm run build

# 4. Deploy Firestore rules and indexes
firebase deploy --only firestore:rules,firestore:indexes

# 5. Deploy hosting (if configured)
firebase deploy --only hosting

# 6. Seed test users (optional)
npm run seed:test-users
```

## Production Deploy Blocked Until Approval

Production deployment is **BLOCKED** until:

1. Staging verification is complete (see `PHASE1_ROLLOUT_CHECKLIST.md`).
2. Owner/admin has signed off on staging test results.
3. At least one employee, one manager, and one admin have successfully tested their flows.
4. Firestore rules have been verified with real Firebase project (not just emulator).
5. Mobile punch UX has been verified on at least one physical device.

Do **NOT** deploy to production without explicit manual approval.
