# LAUNCH_CHECKLIST.md — Pre-Production & Phase 1 Launch Readiness (Internal Employee Time Tracking)

**Agent**: QA/Security Agent  
**Worktree**: qa/testing-security  
**Context**: All prior planning+architecture+audit artifacts must be green. This is the last first-run document.

**Usage**: Human + Manager use this as the final gate before allowing Clock Agent to start writing production punch code.

---

## A. Security & Compliance (Must Be Complete or Waived with Risk Sign-off)

1. **Audit log collection + mandatory correction reason** implemented, tested (TESTING_CHECKLIST §4 + §6), and merged.
2. **All time math forced through `America/Los_Angeles`** (TESTING_CHECKLIST §2). Zero remaining raw browser `Date` in payroll path.
3. Firebase web key rotation executed + documented date in `docs/operations/KEY_ROTATION.md` (new file).
4. `.env.example` added to repo with Vite `VITE_FIREBASE_*` variables + .env* is in `.gitignore`.
5. Firestore rules unit tests (TESTING_CHECKLIST §1) exist, pass, and execute in CI on PRs (or explicitly waived by Manager + Ops lead with schedule).
6. Any admin correction bypass older direct-edit UI paths have been removed or prominently warn "use audit correction flow".
7. Soft-status field migration (`status: 'active'`) backfilled for all existing timeEntries + test proof in matrix.
8. Security headers / CSP review performed (Firebase Hosting headers + app meta tags). Document findings.

**Owner**: Admin Agent + DevOps + QA sign-off checkbox.

---

## B. Operational Documentation Updates

- `ONBOARDING_RUNBOOK.md` updated with Clock screen usage + "what changed" for existing employees.
- `WEEK1_OPERATIONS.md` updated with new correction + audit procedure.
- New `docs/operations/PHASE1_ROLLBACK.md` created:
  - Exact steps to revert the merged Clock + Admin PRs via git.
  - Firebase PITR or Firestore export/restore recipe.
  - Communication template for employees if time entries must be frozen temporarily.
- `TIME_INTEGRITY_PLAN.md` reviewed against actual Phase 1 implementation (diff section at bottom of file).
- This `LAUNCH_CHECKLIST.md` itself moved/copied to `docs/operations/` on final merge.

---

## C. Testing Sign-off

Per TESTING_CHECKLIST.md:
- Rule unit tests green.
- Timezone PT + DST matrix green (no browser local time leakage).
- Punch clock + correction + mandatory reason + audit log paths all green in unit + manual.
- Overtime regression + migration backfill tests green.
- Load/concurrency (double-punch, concurrent tabs) verified.

**Minimal gate**: 100% pass rate on newly added tests; no pre-existing test suite regressions.

---

## D. Deploy & Environment Readiness

1. Firebase emulators + prod parity verified (indexes, rules, functions parity if any added).
2. Hosting preview channel created for at least one full business day of UAT before prod cutover.
3. Custom domain cert still valid on `time.americantiledepot.com`.
4. Monitoring/alerting:
   - Basic error-rate alert configured (Firebase or external).
   - Manual "who is clocked in right now" query tested under load.
5. Payroll export (CSV) run against the preview channel and compared byte-for-byte format with previous production extracts (no column drift).

---

## E. Training & Change Management

- Manager & Admin training session (≤60 min) covering the new punch UI, correction with reason dialog, and back-office audit viewer differences.
- Employee flyer / in-app tooltip explaining the simpler one-tap clock flow (and assurance that the old manual steps remain available during transition).
- Slack / Teams channel pinned message with "Report punch problems" escalation path.

---

## F. Cutover Day Checklist (T-1 to T+3)

**T-1 (Day before go-live)**:
- [ ] Prod backup/export executed (Firestore all critical collections).
- [ ] Key rollback git commit staged (Clock + Admin merges reverted) and tested in preview channel.
- [ ] All employees reminded of new punch screen.
- [ ] Admin ticket board created ("Phase 1 Punch Launch").

**Go-Live Morning (T-0)**:
- [ ] Deploy merged branches in exact merge order (audit → architecture → qa → punch and/or admin).
- [ ] Verify emulators disabled in prod build.
- [ ] Smoke test 3 employees across roles: punch in/out, see today/week history, manager views team, admin corrects one entry with reason visible in audit.
- [ ] Real-time payroll export CSV regenerated and spot-checked by finance paymaster.

**T+1 / T+2**:
- [ ] Monitor support channel for "clock won't work", "yesterday blocker edge", "lunch warning" edge cases.
- [ ] Every production correction this week triggers audit log row (random audit by Manager or QA).
- [ ] Any TZ or DST anomalies immediately escalated.
- [ ] Log of all backfilled records created during the initial data fix.

**T+3 (Go/No-Go Retrospective)**:
- [ ] First payroll that used the new system completed successfully.
- [ ] Decision: keep both legacy step form + new punch, or deprecate step form?
- [ ] Decision: open HR Phase 2 gate or defer one more sprint?
- [ ] Archive this checklist result + attach any incident tickets.

---

## G. People & Approvals (Named Checkboxes)

| Role | Name (Fill) | Date | Signed |
|------|-------------|------|--------|
| Operations / Payroll Owner |  |  |  |
| Admin Lead |  |  |  |
| Manager Lead |  |  |  |
| QA/Security Agent |  |  |  |
| Architecture (data model + rules) |  |  |  |
| Manager Agent (overall coordination) |  |  |  |
| Human Final Go-Live Decision |  |  |  |

---

## H. Post-Launch (First 30 Days) Items

- Weekly "audit spot check" of 5 correction entries for reason + log row quality.
- Close any Phase 1 technical debt tickets (simpler legacy step form removal, cleanup of duplicated MUI/lucide icons, etc.).
- Schedule Phase 2 kickoff only after 2 successful payrolls under Phase 1.

---

## I. Explicit First-Run QA Agent Declaration

All items in this checklist were derived from:
- Live code inspection on 2026-05-25
- Operational docs in tree (especially TIME_INTEGRITY_PLAN, ONBOARDING, WEEK1, TESTING_GUIDE)
- The non-negotiable master prompt rules
- The sibling planning, audit, architecture, and HR plan documents produced in this coordinated session

**No code or configuration was altered by the QA agent during this first-run planning experiment.**

---

**End of First-Run Artifact Set**:
- 3 Manager planning docs
- 1 Audit assessment
- 3 Architecture design docs (plan + model + rules)
- 1 HR leave/holiday plan
- 1 QA security review
- 1 Testing checklist
- 1 Launch checklist

**Total planning deliverables delivered: 11 / 11 requested in the original prompt.**

Ready for human review and Manager closure note.
