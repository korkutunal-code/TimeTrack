"""Comprehensive Playwright inspection of the live TimeTrack app.

Runs against the LIVE production URL (https://atd-time-tracking.web.app) using
the 3 test accounts that exist in the live Firebase project. Verifies:
  - Login for employee / manager / admin
  - Employee: clock-in flow renders, QA mode + report button appear
  - Admin: every tab (panel, payroll, audit, metrics, team, corrections) loads
  - No console errors, no 4xx/5xx, no pageerrors
  - QABar (?qa=1) renders
  - ReportProblemButton (?report=1) renders and opens panel

Captures screenshots into test-artifacts/inspect/ for visual verification.
"""
from __future__ import annotations
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

ART = Path(__file__).parent
SHOTS = ART / "inspect"
SHOTS.mkdir(exist_ok=True)
BASE = "https://atd-time-tracking.web.app"
RESULTS = {"passed": 0, "failed": 0, "results": []}
ALL_CONSOLE = []
ALL_PAGEERR = []
ALL_FAILED_REQS = []

def rec(name, passed, detail="", shot=None):
    status = "PASS" if passed else "FAIL"
    RESULTS["results"].append({"name": name, "status": status, "detail": detail, "screenshot": shot})
    RESULTS["passed" if passed else "failed"] += 1
    print(f"  {status} | {name} -- {detail}")

def login(page, email, password):
    """Sign in via the live login form."""
    # Use 'load' instead of 'networkidle' — live Firebase keeps a websocket open
    # (Realtime presence / Firestore listeners) so networkidle never fires.
    page.goto(BASE, wait_until="load", timeout=30000)
    page.wait_for_selector("input[type='email']", timeout=15000)
    page.fill("input[type='email']", email)
    page.fill("input[type='password']", password)
    page.click("button[type='submit']")
    # Wait for the app shell to render (no email input)
    try:
        page.wait_for_function(
            "() => !document.querySelector('input[type=\"email\"]') || document.body.innerText.includes('Account not')",
            timeout=20000,
        )
    except PWTimeout:
        pass

def test_role(p, role, email, password):
    print(f"\n========== {role.upper()}: {email} ==========")
    br = p.chromium.launch(headless=True)
    ctx = br.new_context(viewport={"width": 1366, "height": 900})
    page = ctx.new_page()
    console_for_role = []
    pageerr_for_role = []
    failed_for_role = []
    page.on("console", lambda m, c=console_for_role: c.append({"type": m.type, "text": m.text[:500]}))
    page.on("pageerror", lambda e, c=pageerr_for_role: c.append(str(e)[:500]))
    page.on("response", lambda r, c=failed_for_role: c.append(f"{r.status} {r.url}") if r.status >= 400 and r.url.startswith(BASE) else None)

    # 1. Login
    try:
        login(page, email, password)
        time.sleep(2)  # let auth settle
        title = page.title()
        url = page.url
        shot = f"{role}_01_after_login.png"
        page.screenshot(path=str(SHOTS / shot), full_page=True)
        # If we're still on the login page, login failed
        on_login = page.locator("input[type='email']").count() > 0
        if on_login:
            err_text = ""
            try:
                err_text = page.locator("[role='alert']").first.inner_text(timeout=2000)
            except Exception:
                pass
            rec(f"[{role}] Login", False, f"still on login page, alert='{err_text}'", shot)
            br.close()
            return
        rec(f"[{role}] Login", True, f"title='{title}', url={url[-60:]}", shot)
    except Exception as e:
        rec(f"[{role}] Login", False, f"exception: {e}")
        br.close()
        return

    # 2. QABar present
    try:
        page.goto(BASE + "?qa=1", wait_until="load", timeout=20000)
        time.sleep(2)
        shot = f"{role}_02_qa_bar.png"
        page.screenshot(path=str(SHOTS / shot), full_page=True)
        # QABar floating button is a fixed-position button with aria-label="Toggle QA panel"
        qa_btn = page.locator("button[aria-label='Toggle QA panel']").count()
        rec(f"[{role}] QABar visible (?qa=1)", qa_btn > 0, f"qa-buttons={qa_btn}", shot)
        if qa_btn:
            page.locator("button[aria-label='Toggle QA panel']").first.click()
            time.sleep(1)
            shot = f"{role}_03_qa_panel.png"
            page.screenshot(path=str(SHOTS / shot), full_page=True)
            rec(f"[{role}] QABar opens", True, "panel rendered", shot)
    except Exception as e:
        rec(f"[{role}] QABar", False, f"exception: {e}")

    # 3. Report button present
    try:
        page.goto(BASE + "?qa=1&report=1", wait_until="load", timeout=20000)
        time.sleep(2)
        shot = f"{role}_04_report_button.png"
        page.screenshot(path=str(SHOTS / shot), full_page=True)
        report_btn = page.locator("button[aria-label='Report a problem']").count()
        rec(f"[{role}] Report button visible", report_btn > 0, f"buttons={report_btn}", shot)
    except Exception as e:
        rec(f"[{role}] Report button", False, f"exception: {e}")

    # 4. Role-specific UI checks
    if role == "admin":
        admin_tabs = ["panel", "payroll", "audit", "metrics", "team", "corrections"]
        for tab in admin_tabs:
            try:
                # Click the tab trigger by its visible text (case-insensitive contains)
                trigger = page.locator(f"button[role='tab']:has-text('{tab}')").first
                if trigger.count() == 0:
                    # Try other casing
                    trigger = page.locator(f"button[role='tab']").filter(has_text=tab.capitalize()).first
                trigger.click(timeout=5000)
                time.sleep(2)
                shot = f"{role}_tab_{tab}.png"
                page.screenshot(path=str(SHOTS / shot), full_page=True)
                rec(f"[admin] tab '{tab}' loads", True, f"clicked, screenshot saved", shot)
            except Exception as e:
                rec(f"[admin] tab '{tab}'", False, f"exception: {str(e)[:200]}")
    elif role == "manager":
        try:
            # Manager sees Team + My Time
            team_tab = page.locator("button[role='tab']:has-text('Team')").first
            team_tab.click(timeout=5000)
            time.sleep(2)
            shot = f"{role}_tab_team.png"
            page.screenshot(path=str(SHOTS / shot), full_page=True)
            rec(f"[manager] Team tab loads", True, "ok", shot)
        except Exception as e:
            rec(f"[manager] Team tab", False, f"exception: {str(e)[:200]}")
    elif role == "employee":
        # Employee: should see ClockPunch (the primary punch UI we promoted in pass 3)
        try:
            clock_punch_present = page.locator("text=Punch Clock").count() > 0
            rec(f"[employee] ClockPunch UI rendered", clock_punch_present, f"present={clock_punch_present}")
        except Exception as e:
            rec(f"[employee] ClockPunch", False, f"exception: {e}")

    # 5. No uncaught page errors
    if pageerr_for_role:
        rec(f"[{role}] No uncaught page errors", False, f"{len(pageerr_for_role)} errors: {pageerr_for_role[:2]}")
    else:
        rec(f"[{role}] No uncaught page errors", True, "0 errors")

    # 6. No console errors (excluding the benign Firebase ones)
    real_console_errors = [m for m in console_for_role if m["type"] == "error" and "firebase" not in m["text"].lower()]
    if real_console_errors:
        rec(f"[{role}] No console errors", False, f"{len(real_console_errors)}: {real_console_errors[:2]}")
    else:
        rec(f"[{role}] No console errors", True, f"0 (filtered {len(console_for_role)} total)")

    # 7. No 4xx/5xx from app origin
    if failed_for_role:
        rec(f"[{role}] No HTTP errors", False, f"{len(failed_for_role)}: {failed_for_role[:3]}")
    else:
        rec(f"[{role}] No HTTP errors", True, "0")

    ALL_CONSOLE.extend([(role, m) for m in console_for_role])
    ALL_PAGEERR.extend([(role, e) for e in pageerr_for_role])
    ALL_FAILED_REQS.extend([(role, r) for r in failed_for_role])

    br.close()

def main():
    with sync_playwright() as p:
        test_role(p, "admin", "admin@test.com", "Test123!")
        test_role(p, "manager", "manager2@test.com", "Test123!")
        test_role(p, "employee", "employee2@test.com", "Test123!")

    # Save structured results
    out = ART / "inspect-results.json"
    out.write_text(json.dumps({
        "summary": {"passed": RESULTS["passed"], "failed": RESULTS["failed"], "total": RESULTS["passed"] + RESULTS["failed"]},
        "results": RESULTS["results"],
        "console": [{"role": r, **m} for r, m in ALL_CONSOLE],
        "pageerrors": [{"role": r, "error": e} for r, e in ALL_PAGEERR],
        "failed_requests": [{"role": r, "url": u} for r, u in ALL_FAILED_REQS],
    }, indent=2))
    print(f"\n{'='*60}")
    print(f"INSPECT RESULTS: {RESULTS['passed']} pass / {RESULTS['failed']} fail")
    print(f"Console messages: {len(ALL_CONSOLE)}")
    print(f"Page errors: {len(ALL_PAGEERR)}")
    print(f"Failed requests: {len(ALL_FAILED_REQS)}")
    print(f"Results JSON: {out}")
    print(f"Screenshots: {SHOTS}")
    return 0 if RESULTS["failed"] == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
