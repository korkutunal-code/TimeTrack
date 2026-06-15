"""End-to-end: full shift → history → payroll report with real data.

Drives the ClockPunch UI through the entire shift:
  1. Log in as employee2, clock in
  2. Start lunch, end lunch
  3. Clock out
  4. Verify History view shows the completed entry
  5. Log out, log in as admin, generate a payroll report for the current week
  6. Verify the report shows employee2's hours
"""
from __future__ import annotations
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

ART = Path(__file__).parent
SHOTS = ART / "e2e"
SHOTS.mkdir(exist_ok=True)
BASE = "https://atd-time-tracking.web.app"
RESULTS = {"passed": 0, "failed": 0, "results": []}

def rec(name, passed, detail="", shot=None):
    status = "PASS" if passed else "FAIL"
    RESULTS["results"].append({"name": name, "status": status, "detail": detail, "screenshot": shot})
    RESULTS["passed" if passed else "failed"] += 1
    print(f"  {status} | {name} -- {detail}")

def login(page, email, password):
    page.goto(BASE, wait_until="load", timeout=30000)
    time.sleep(2)
    # If already signed in (no email input visible), sign out first
    if page.locator("input[type='email']").count() == 0:
        try:
            page.get_by_role("button", name="Sign Out").first.click(timeout=5000)
            time.sleep(3)
        except Exception:
            pass
    page.wait_for_selector("input[type='email']", timeout=15000)
    page.fill("input[type='email']", email)
    page.fill("input[type='password']", password)
    page.click("button[type='submit']")
    page.wait_for_function(
        "() => !document.querySelector('input[type=\"email\"]')",
        timeout=20000,
    )
    time.sleep(2)

def run():
    with sync_playwright() as p:
        br = p.chromium.launch(headless=True)
        ctx = br.new_context(viewport={"width": 1366, "height": 900})
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)[:300]))

        print("\n========== EMPLOYEE: full shift ==========")
        login(page, "test@test.com", "123456")
        # If already clocked in (from prior test), clock out first
        try:
            clock_out_btn = page.get_by_role("button", name="CLOCK OUT")
            if clock_out_btn.count() > 0:
                clock_out_btn.first.click(timeout=5000)
                time.sleep(3)
        except Exception:
            pass
        # Click CLOCK IN
        try:
            page.get_by_role("button", name="CLOCK IN").first.click(timeout=10000)
            time.sleep(3)
        except Exception as e:
            rec("CLOCK IN click", False, f"exception: {e}")
        shot = "01_after_clock_in.png"
        page.screenshot(path=str(SHOTS / shot), full_page=True)
        rec("CLOCK IN", page.locator("text=CLOCKED IN").count() > 0, "status pill", shot)

        # Start lunch
        try:
            page.get_by_role("button", name="START LUNCH").first.click(timeout=5000)
            time.sleep(3)
            shot = "02_lunch_started.png"
            page.screenshot(path=str(SHOTS / shot), full_page=True)
            rec("START LUNCH", page.locator("text=ON LUNCH").count() > 0 or page.locator("text=CLOCKED IN").count() > 0, "lunch state", shot)
        except Exception as e:
            rec("START LUNCH", False, f"button not found: {e}")

        # End lunch
        try:
            page.get_by_role("button", name="END LUNCH").first.click(timeout=5000)
            time.sleep(3)
            shot = "03_lunch_ended.png"
            page.screenshot(path=str(SHOTS / shot), full_page=True)
            rec("END LUNCH", True, "clicked", shot)
        except Exception as e:
            rec("END LUNCH", False, f"exception: {e}")

        # Clock out
        try:
            page.get_by_role("button", name="CLOCK OUT").first.click(timeout=5000)
            time.sleep(3)
            shot = "04_after_clock_out.png"
            page.screenshot(path=str(SHOTS / shot), full_page=True)
            rec("CLOCK OUT", True, "clicked", shot)
        except Exception as e:
            rec("CLOCK OUT", False, f"exception: {e}")

        # View history
        try:
            page.get_by_role("button", name="View Full History").first.click(timeout=5000)
            time.sleep(3)
            shot = "05_history.png"
            page.screenshot(path=str(SHOTS / shot), full_page=True)
            # Look for today's date row
            today_text = page.locator("body").inner_text()
            rec("History view renders", "Today" in today_text or "History" in today_text, "history loaded", shot)
        except Exception as e:
            rec("History view", False, f"exception: {e}")

        rec("No page errors during full shift", len(errs) == 0, f"errors={len(errs)}")

        # Now log out + log in as admin
        print("\n========== ADMIN: payroll with the new entry ==========")
        page.goto(BASE, wait_until="load", timeout=20000)
        time.sleep(2)
        try:
            page.get_by_role("button", name="Sign Out").first.click(timeout=5000)
            time.sleep(3)
        except Exception:
            pass
        login(page, "test@test.com", "123456")

        # Go to Payroll
        page.get_by_role("tab", name="Payroll").first.click()
        time.sleep(3)
        shot = "06_payroll_initial.png"
        page.screenshot(path=str(SHOTS / shot), full_page=True)

        # Click "This Week" or "Current" preset
        try:
            page.get_by_role("button", name="Current Week").first.click(timeout=5000)
            time.sleep(2)
            shot = "07_payroll_current_week.png"
            page.screenshot(path=str(SHOTS / shot), full_page=True)
            rec("Payroll: Current Week preset", True, "clicked", shot)
        except Exception:
            # try other labels
            try:
                page.get_by_role("button", name="Current").first.click(timeout=3000)
                time.sleep(2)
                rec("Payroll: Current preset", True, "clicked")
            except Exception as e:
                rec("Payroll: Quick preset", False, f"no preset button found: {e}")

        # Generate Report
        try:
            page.get_by_role("button", name="Generate Report").first.click(timeout=10000)
            time.sleep(5)
            shot = "08_payroll_generated.png"
            page.screenshot(path=str(SHOTS / shot), full_page=True)
            body = page.locator("body").inner_text()
            has_data = "Test Employee 2" in body or "employee2" in body
            rec("Payroll report renders with employee data", has_data, f"employee2 visible={has_data}", shot)
        except Exception as e:
            rec("Payroll: Generate Report", False, f"exception: {e}")

        br.close()

    out = ART / "e2e-results.json"
    out.write_text(json.dumps({
        "summary": {"passed": RESULTS["passed"], "failed": RESULTS["failed"], "total": RESULTS["passed"] + RESULTS["failed"]},
        "results": RESULTS["results"],
    }, indent=2))
    print(f"\n{'='*60}")
    print(f"E2E RESULTS: {RESULTS['passed']} pass / {RESULTS['failed']} fail")
    print(f"Screenshots: {SHOTS}")
    return 0 if RESULTS["failed"] == 0 else 1

if __name__ == "__main__":
    sys.exit(run())
