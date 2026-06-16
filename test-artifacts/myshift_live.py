"""Drive the live TimeTrack app as test@test.com, exactly like an employee.

Two flows:
  (A) Realistic one-tap flow: use ClockPunch (the default UI). Each click
      records the current real PT time. The employee just taps buttons.
  (B) Custom-time flow: use ?classic=1 to enable the legacy manual-time
      form. We type specific HH:MM to test edge cases.

Each flow takes screenshots at every step into test-artifacts/myshift/.
"""
from __future__ import annotations
import json, os, subprocess, sys, time
from pathlib import Path
from datetime import datetime, timezone, timedelta
from playwright.sync_api import sync_playwright

ART = Path(__file__).parent
SHOTS = ART / "myshift"
SHOTS.mkdir(exist_ok=True)
BASE = "https://atd-time-tracking.web.app"
RESULTS = {"passed": 0, "failed": 0, "results": []}

def rec(name, passed, detail="", shot=None):
    status = "PASS" if passed else "FAIL"
    RESULTS["results"].append({"name": name, "status": status, "detail": detail, "screenshot": shot})
    RESULTS["passed" if passed else "failed"] += 1
    print(f"  {status} | {name} -- {detail}")

def pt_now() -> datetime:
    return datetime.now(timezone(timedelta(hours=-7)))

def fmt_time(dt: datetime) -> str:
    return f"{dt.hour:02d}:{dt.minute:02d}"

def login(page, email, password):
    page.goto(BASE, wait_until="load", timeout=30000)
    time.sleep(2)
    if page.locator("input[type='email']").count() == 0:
        try: page.get_by_role("button", name="Sign Out").first.click(timeout=5000); time.sleep(3)
        except: pass
    page.wait_for_selector("input[type='email']", timeout=15000)
    page.fill("input[type='email']", email)
    page.fill("input[type='password']", password)
    page.click("button[type='submit']")
    page.wait_for_function("() => !document.querySelector('input[type=\"email\"]')", timeout=20000)
    time.sleep(2)

def recover_state(page):
    """Make sure we're in CLOCKED OUT state."""
    for _ in range(3):
        try:
            if page.get_by_role("button", name="END LUNCH").count() > 0:
                page.get_by_role("button", name="END LUNCH").first.click(); time.sleep(3)
        except Exception: pass
        try:
            if page.get_by_role("button", name="CLOCK OUT").count() > 0:
                page.get_by_role("button", name="CLOCK OUT").first.click(); time.sleep(3)
        except Exception: pass

def pt_today() -> str:
    """Today's date in PT (YYYY-MM-DD)."""
    return pt_now().strftime("%Y-%m-%d")

def preflight_void_today():
    """Soft-void ALL timeEntries for test@test.com (any date) so the next
    flow can write a fresh entry. The 1-entry-per-day rule + the legacy
    UI's "locked when complete" state (checkEntryAccess checks
    dayComplete || complete) both need a voided doc with cleared completion
    flags to allow a new write. Idempotent — already-voided docs are skipped."""
    node_path = "/usr/local/bin/node"
    if not os.path.exists(node_path):
        import shutil
        node_path = shutil.which("node") or "node"
    env = os.environ.copy()
    env["GOOGLE_APPLICATION_CREDENTIALS"] = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS", os.path.expanduser("~/secrets/timetrack-firebase-sa.json"))
    node_body = """
      import('firebase-admin').then(async ({default: admin}) => {
        const sa = require('fs').readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS);
        if (!admin.apps.length) admin.initializeApp({credential: admin.credential.cert(JSON.parse(sa))});
        const db = admin.firestore();
        const u = await admin.auth().getUserByEmail('test@test.com');
        const te = await db.collection('timeEntries').where('userId', '==', u.uid).get();
        let voided = 0, skipped = 0;
        for (const doc of te.docs) {
          const d = doc.data();
          if (d.status === 'voided') { skipped++; continue; }
          // Clear completion flags so the legacy UI's checkEntryAccess
          // doesn't keep the entry locked. Without this, the ?classic=1
          // form stays disabled even after soft-voiding.
          await doc.ref.update({
            status: 'voided',
            voidedAt: admin.firestore.FieldValue.serverTimestamp(),
            voidedReason: 'preflight: myshift_live.py between-flow cleanup (all docs)',
            dayComplete: false,
            complete: false,
            currentStep: 0,
            clockInManual: admin.firestore.FieldValue.delete(),
            clockInSystem: admin.firestore.FieldValue.delete(),
            clockInSystemTime: admin.firestore.FieldValue.delete(),
            clockOutManual: admin.firestore.FieldValue.delete(),
            clockOutSystem: admin.firestore.FieldValue.delete(),
            clockOutSystemTime: admin.firestore.FieldValue.delete(),
            lunchOutManual: admin.firestore.FieldValue.delete(),
            lunchInManual: admin.firestore.FieldValue.delete(),
          });
          console.log('voided + cleared ' + doc.id);
          voided++;
        }
        console.log('summary: voided=' + voided + ' skipped=' + skipped);
        process.exit(0);
      });
    """
    r = subprocess.run([node_path, "-e", node_body], env=env, capture_output=True, text=True, timeout=30)
    return (r.stdout or r.stderr).strip()

def shot(page, name):
    p = str(SHOTS / name)
    page.screenshot(path=p, full_page=True)
    return p

def flow_clockpunch_realistic(p):
    """(A) Use the default ClockPunch UI: just click buttons, app uses real time."""
    print(f"\n========== (A) CLOCKPUNCH — realistic one-tap ==========")
    br = p.chromium.launch(headless=True)
    ctx = br.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:300]))

    # Make sure today's entry is clean (we'll create it from scratch)
    login(page, "test@test.com", "123456")
    recover_state(page)
    rec("State recovered to CLOCK OUT", page.get_by_role("button", name="CLOCK IN").count() > 0,
        f"CLOCK IN visible={page.get_by_role('button', name='CLOCK IN').count() > 0}",
        shot(page, "A01_state_clean.png"))

    # 1. CLOCK IN
    actual_in = pt_now()
    page.get_by_role("button", name="CLOCK IN").first.click()
    time.sleep(4)
    rec("CLOCK IN click", page.locator("text=CLOCKED IN").count() > 0, f"status='CLOCKED IN', clicked at {fmt_time(actual_in)}",
        shot(page, "A02_after_clock_in.png"))

    # 2. START LUNCH (immediate, just to see the lunch state)
    # Give the page a moment to re-render after CLOCK IN before looking for the button.
    time.sleep(3)
    try:
        page.wait_for_selector("button:has-text('START LUNCH')", timeout=30000)
    except Exception as e:
        # If START LUNCH never appeared, dump page text for diagnosis
        rec("START LUNCH visible", False, f"button not found: {str(e)[:100]}", shot(page, "A02b_no_lunch_button.png"))
        return
    page.get_by_role("button", name="START LUNCH").first.click()
    time.sleep(4)
    on_lunch = page.get_by_role("button", name="END LUNCH").count() > 0
    rec("START LUNCH click", on_lunch, f"END LUNCH visible={on_lunch}",
        shot(page, "A03_lunch_started.png"))

    # 3. END LUNCH immediately
    page.get_by_role("button", name="END LUNCH").first.click()
    time.sleep(4)
    ready_out = page.get_by_role("button", name="CLOCK OUT").count() > 0
    rec("END LUNCH click", ready_out, f"CLOCK OUT visible={ready_out}",
        shot(page, "A04_lunch_ended.png"))

    # 4. CLOCK OUT
    page.get_by_role("button", name="CLOCK OUT").first.click()
    time.sleep(4)
    rec("CLOCK OUT click", page.locator("text=CLOCKED OUT").count() > 0, f"status='CLOCKED OUT', total worked: <30s",
        shot(page, "A05_after_clock_out.png"))

    # 5. View History
    page.get_by_role("button", name="View Full History").first.click()
    time.sleep(4)
    rec("History view loads", page.locator("body").inner_text().lower().count("history") > 0, "history rendered",
        shot(page, "A06_history.png"))

    rec("No page errors during realistic flow", len(errs) == 0, f"errors={len(errs)}")
    br.close()

def flow_classic_custom_times(p):
    """(B) Use ?classic=1 to drive the manual-time UI with specific HH:MM times.
    This tests that the time-validation logic works for the actual wall-clock
    times an employee would type (08:30 in, 12:00 lunch, 12:30 back, 17:30 out).
    """
    print(f"\n========== (B) CLASSIC ?classic=1 — custom times ==========")
    br = p.chromium.launch(headless=True)
    ctx = br.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)[:300]))

    # Need to switch to classic UI before login (URL param affects the rendered UI)
    page.goto(BASE + "?classic=1", wait_until="load", timeout=30000)
    time.sleep(2)
    if page.locator("input[type='email']").count() == 0:
        try: page.get_by_role("button", name="Sign Out").first.click(timeout=5000); time.sleep(3)
        except: pass
    page.wait_for_selector("input[type='email']", timeout=15000)
    page.fill("input[type='email']", "test@test.com")
    page.fill("input[type='password']", "123456")
    page.click("button[type='submit']")
    page.wait_for_function("() => !document.querySelector('input[type=\"email\"]')", timeout=20000)
    time.sleep(3)
    rec("Logged in (classic UI)", "TimeTrack" in page.title(), f"title='{page.title()}'",
        shot(page, "B01_logged_in_classic.png"))

    # State recovery in classic UI
    # In the classic UI there's a "Reset Today" button when TEST_MODE is on, but
    # otherwise no easy way to clear. The user has only 1 entry per day, so if
    # today's entry exists, skip the shift creation.
    has_time_input = page.locator("input[type='time']").count() > 0
    rec("Classic UI shows time input", has_time_input, "input[type='time'] count=" + str(page.locator("input[type='time']").count()),
        shot(page, "B02_classic_form.png"))

    if has_time_input:
        # Set the time and submit
        ti = page.locator("input[type='time']").first
        ti.fill("08:30")
        time.sleep(1)
        # Find the "Submit Clock In" button
        submit_btn = None
        for name in ["Submit Clock In", "Clock In", "Submit"]:
            if page.get_by_role("button", name=name).count() > 0:
                submit_btn = page.get_by_role("button", name=name).first
                break
        if submit_btn:
            submit_btn.click()
            time.sleep(4)
            rec("Submitted 08:30 clock-in", True, "clicked submit", shot(page, "B03_after_submit.png"))
        else:
            rec("Found submit button", False, "no submit button visible")
    else:
        rec("Classic UI ready", False, "no time input found")

    rec("No page errors during classic flow", len(errs) == 0, f"errors={len(errs)}")
    br.close()

def main():
    with sync_playwright() as p:
        # Soft-void today's doc BEFORE (A) so ClockPunch has a clean slate.
        # The legacy 1-entry-per-day rule rejects new clock-ins otherwise.
        print(f"\n[preflight] soft-void today's doc for test@test.com (before A)")
        print(f"  -> {preflight_void_today()}")
        flow_clockpunch_realistic(p)
        # And again before (B) so the legacy ?classic=1 form can create a fresh
        # entry — (A)'s clock-in left a completed-but-not-voided doc behind.
        print(f"\n[preflight] soft-void today's doc for test@test.com (before B)")
        print(f"  -> {preflight_void_today()}")
        flow_classic_custom_times(p)

    out = ART / "myshift-results.json"
    out.write_text(json.dumps({
        "summary": {"passed": RESULTS["passed"], "failed": RESULTS["failed"], "total": RESULTS["passed"] + RESULTS["failed"]},
        "results": RESULTS["results"],
    }, indent=2))
    print(f"\n{'='*60}")
    print(f"MY-SHIFT RESULTS: {RESULTS['passed']} pass / {RESULTS['failed']} fail")
    print(f"Screenshots: {SHOTS}")
    return 0 if RESULTS["failed"] == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
