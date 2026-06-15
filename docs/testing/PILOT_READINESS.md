# TimeTrack — Pilot Readiness Notes

**Last updated:** 2026-04-16
**Companion to:** [`TEST_REPORT.md`](./TEST_REPORT.md)
**Live URL:** https://atd-time-tracking.web.app

> **Purpose:** A quick-reference brief so the next engineer (or future us)
> can pick this up and know exactly where the app stands, what's safe, what
> isn't, and what to do next. If you're coming back to this project after
> a break, **read this file first**, then the full report.

---

## TL;DR

- ✅ **Pilot (3–5 users, 1–2 pay cycles): READY**
- ⚠️ **Full org-wide rollout: NOT YET** — blocked on 3 items in §5
- 🐞 **TT-OT-001 (California weekly-OT over-deduction): FIXED** and regression-tested
- 📦 Deployed to production `atd-time-tracking.web.app`

---

## 1. What was proven in the test pass ✅

- Login / Register / Reset / Google SSO UI renders on desktop **and** 390×844 mobile
- Production Vite build clean (1741 modules, ~1.6 s)
- No 4xx/5xx responses, no uncaught JavaScript errors on the live origin
- TypeScript is clean (`npx tsc --noEmit`)
- Jest: **55/55 passing across 3 suites**
- California overtime math correct, including the previously-broken 40h-weekly rollover case
- Firebase Hosting deploy pipeline works; rollback is one command

## 2. What was NOT tested ❌ (because there's no seeded test user)

The automated suite stopped at the login page. Nothing below the login has
been exercised end-to-end in this pass. Humans must verify:

- Employee: clock in/out, lunch out/in, edit prior entries, submit correction
- Manager: approve corrections, scan Team Dashboard for lunch warnings
- Admin: payroll reports (especially biweekly with >40h regular weeks), audit viewer, pattern metrics
- Google SSO full round-trip
- Firestore security rules under real user sessions (existing script `scripts/test-firestore-rules.js` has not been run in this pass)
- Offline banner behaviour

## 3. Pilot playbook — give this to testers

**Size:** 3–5 people covering all three roles.
**Duration:** at least **one full biweekly pay cycle** (ideally two).

**Employees (everyone):**
1. Register with your assigned email, or log in if already created
2. Clock in / lunch out / lunch in / clock out for a real workday
3. The next day, edit yesterday's entry in History → submit a correction request
4. Confirm the daily total matches what you expect to the nearest minute

**Manager (pick one):**
1. Approve at least one submitted correction
2. Scan the Team Dashboard — any missing/short/long lunches surfaced?

**Admin (you):**
1. Run a biweekly payroll export
2. **Critical:** include at least one week with >40 regular hours. Hand-calculate a known-good week and compare totals. This is the scenario TT-OT-001 previously broke.
3. Spot-check the Audit Viewer for the new corrections

**Everyone:** report issues with **browser + device + time of day**.

## 4. Known non-blocking findings (tell testers ahead of time)

1. **Error toast is ephemeral.** If your login fails, an error flashes briefly at the top (~4 s) and disappears. Planned UX fix is to replace it with inline error text. For now, watch the top-of-screen closely after a failed login.
2. **Dev-only logs** — `console.info` React DevTools banner is expected in dev; not present in production.

## 5. Before scaling past the pilot — THREE must-dos

### 5.1 Run the Firestore rules test suite
```bash
npm run test:rules
```
This exercises [`firestore.rules`](../../firestore.rules) via the emulator and
is our defense against "employee reads another employee's hours." It has
**not** been run in this pass.

### 5.2 Add authenticated-flow Playwright tests
The app already supports emulators via `?emu` query param or
`VITE_USE_EMULATORS=true` — see [`src/app/lib/firebase.ts`](../../src/app/lib/firebase.ts) line 21. Wire the emulator into
[`test-artifacts/ui_smoke_test.py`](../../test-artifacts/ui_smoke_test.py), seed a deterministic test user,
and extend the smoke suite to cover clock-in/out, history edit, and the
admin payroll happy path. Without this, every deploy still relies on eyes-on QA.

### 5.3 Persist the login error UX
Replace the Sonner toast in [`src/app/components/LoginPage.tsx`](../../src/app/components/LoginPage.tsx) (see `handleAuthAction`,
around line 52) with an inline `<Alert variant="destructive">` that stays
until the next submit. Small change, big a11y win.

## 6. If something goes wrong during the pilot

| Symptom | First check | Remediation |
|---|---|---|
| Payroll total looks wrong | Review [`TEST_REPORT.md`](./TEST_REPORT.md) §6; hand-calc one week from raw `TimeEntry` rows | If the 40h rollover is miscalculating, file a new bug — the fix is in [`src/utils/overtimeCalculations.ts`](../../src/utils/overtimeCalculations.ts), `calculateWeeklyOvertimeAdjustments()` |
| Employee sees another employee's data | Treat as P0; stop the pilot | Run `npm run test:rules`; inspect [`firestore.rules`](../../firestore.rules) |
| App won't load / white screen | Browser console + Firebase Hosting status | `firebase hosting:releases:list` then `firebase hosting:clone SITE_ID:CHANNEL_ID VERSION_ID` to roll back |
| Google SSO fails | OAuth config hasn't changed in this pass | Check Firebase console → Authentication → Sign-in method; verify authorized domain list |

### Rollback — one-liner
```bash
# List recent releases
firebase hosting:releases:list

# Re-deploy the previous commit
git checkout <previous-sha> && npm run build && firebase deploy --only hosting --non-interactive
```

## 7. How to re-run the verification suite

Artifacts live under [`test-artifacts/`](../../test-artifacts). All commands
run from the project root.

```bash
# 1. Unit tests
npm test

# 2. Type check
npx tsc --noEmit

# 3. Production build sanity
npm run build

# 4. Local UI smoke (auto-starts dev server on :5173)
python3 /Users/torosasik/.kilocode/skills/webapp-testing/scripts/with_server.py \
  --server "npm run dev -- --host 127.0.0.1 --port 5173 --no-open" \
  --port 5173 --timeout 60 -- \
  python3 test-artifacts/ui_smoke_test.py

# 5. Production UI smoke (hits the live site, no server needed)
python3 test-artifacts/ui_smoke_prod.py
```

Key artifacts to inspect after a run:
- `test-artifacts/jest-final.log`, `test-artifacts/build-output.log`, `test-artifacts/tsc-output.log`
- `test-artifacts/ui-smoke-results.json`, `test-artifacts/ui-smoke-prod-results.json`
- `test-artifacts/screenshots/`, `test-artifacts/screenshots-prod/`
- `test-artifacts/firebase-deploy.log`

## 8. Status board

| Item | State |
|---|---|
| TT-OT-001 weekly-OT over-deduction | ✅ Fixed + regression test live |
| TypeScript | ✅ Clean |
| Jest suite | ✅ 55/55 |
| Production deploy | ✅ https://atd-time-tracking.web.app |
| Firestore rules verified | ❌ Not run in this pass |
| Authenticated-flow UI tests | ❌ Not yet wired (emulator support exists) |
| Login error a11y | ❌ Ephemeral toast — persistent inline error recommended |
| Utilities still without tests | ⚠️ `timeValidation.ts`, `timeWindows.ts`, `scheduleHelpers.js`, `dateHelpers.js`, `permissions.js` |
| CI pipeline (`npm test && npm run build` pre-merge) | ❌ Not yet |
| `esModuleInterop` in `tsconfig.json` | ⚠️ Off — ts-jest logs an advisory on every run |

---

**Decision recorded here so we don't re-debate it next session:**
**Greenlight a small pilot now. Do the §5 items before full rollout.**
