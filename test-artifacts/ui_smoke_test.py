"""UI smoke tests for TimeTrack - runs against live Vite dev server."""
from __future__ import annotations
import json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

ART = Path(__file__).parent
SHOTS = ART / "screenshots"; SHOTS.mkdir(exist_ok=True)
BASE = "http://127.0.0.1:5173/"

results, console_msgs, page_errors = [], [], []

def rec(name, passed, detail="", shot=None):
    results.append({"name": name, "status": "PASS" if passed else "FAIL",
                    "detail": detail, "screenshot": shot})
    print(f"  {'PASS' if passed else 'FAIL'} | {name} -- {detail}")

def run():
    with sync_playwright() as p:
        br = p.chromium.launch(headless=True)
        ctx = br.new_context(viewport={"width": 1366, "height": 900})
        page = ctx.new_page()
        page.on("console", lambda m: console_msgs.append({"type": m.type, "text": m.text[:400]}))
        page.on("pageerror", lambda e: page_errors.append(str(e)[:400]))

        failed_reqs = []
        def on_resp(r):
            try:
                if r.status >= 400 and r.url.startswith(BASE):
                    failed_reqs.append(f"{r.status} {r.url}")
            except Exception:
                pass
        page.on("response", on_resp)

        # 1 Initial load
        print("\n-- 1. Initial load --")
        t0 = time.time()
        try:
            page.goto(BASE, wait_until="networkidle", timeout=20000)
            ms = int((time.time()-t0)*1000)
            page.screenshot(path=str(SHOTS/"01_initial_load.png"), full_page=True)
            rec("App loads", True, f"{ms}ms, title='{page.title()}'", "01_initial_load.png")
        except Exception as e:
            rec("App loads", False, f"nav failed: {e}")
            br.close(); return 1

        # 2 Login elements
        print("\n-- 2. Login page rendering --")
        try:
            page.wait_for_selector("input[type='email']", timeout=10000)
            rec("Email input", True, "input[type=email] rendered")
        except PWTimeout:
            rec("Email input", False, "timeout")

        for sel, label in [
            ("input[type='password']", "Password input"),
            ("button[type='submit']", "Submit button"),
        ]:
            try:
                v = page.locator(sel).first.is_visible()
                rec(label, v, sel)
            except Exception as e:
                rec(label, False, str(e))

        try:
            has_signin = page.locator("text=/sign ?in|log ?in/i").first.is_visible()
            rec("Sign-In label visible", has_signin, "")
        except Exception as e:
            rec("Sign-In label visible", False, str(e))

        # 3 Switch to register view
        print("\n-- 3. View switcher --")
        try:
            page.locator("text=/sign ?up|register|create account|don'?t have/i").first.click(timeout=3000)
            page.wait_for_timeout(400)
            name_field = page.locator("input#name, input[placeholder*='name' i]").first
            ok = name_field.count() > 0 and name_field.is_visible()
            page.screenshot(path=str(SHOTS/"02_register_view.png"), full_page=True)
            rec("Register view shows name field", ok, "name input present", "02_register_view.png")
        except Exception as e:
            rec("Register view shows name field", False, str(e))

        # 4 Password toggle
        print("\n-- 4. Password visibility --")
        try:
            page.goto(BASE, wait_until="networkidle", timeout=15000)
            pw_sel = "input[type='password'], input[name='password']"
            page.locator(pw_sel).first.fill("SecretPass!23")
            initial = page.locator(pw_sel).first.get_attribute("type") or ""
            toggled = False
            # Try all icon-buttons in the password group
            for btn in page.locator("button").all():
                try:
                    btn.click(timeout=400)
                except Exception:
                    continue
                after = page.locator("input[name='password'], input#password, input[type='text'], input[type='password']").first.get_attribute("type") or ""
                if after and after != initial:
                    toggled = True; break
            rec("Password toggle changes input type", toggled,
                f"{initial} -> toggled" if toggled else "no toggle button found")
        except Exception as e:
            rec("Password toggle changes input type", False, str(e))

        # 5 Invalid login feedback
        print("\n-- 5. Invalid login feedback --")
        try:
            page.goto(BASE, wait_until="networkidle", timeout=15000)
            page.locator("input[type='email']").first.fill("nobody@nowhere.test")
            page.locator("input[type='password']").first.fill("wrong-pwd-xyz")
            page.locator("button[type='submit']").first.click()
            page.wait_for_timeout(5000)
            page.screenshot(path=str(SHOTS/"03_invalid_login.png"), full_page=True)
            body = page.locator("body").inner_text().lower()
            ok = any(k in body for k in ["invalid", "failed", "error", "wrong", "incorrect", "network"])
            rec("Invalid login shows error", ok,
                "error text detected" if ok else "no error text in DOM",
                "03_invalid_login.png")
        except Exception as e:
            rec("Invalid login shows error", False, str(e))

        # 6 Mobile viewport
        print("\n-- 6. Mobile viewport --")
        try:
            page.set_viewport_size({"width": 390, "height": 844})
            page.goto(BASE, wait_until="networkidle", timeout=15000)
            page.screenshot(path=str(SHOTS/"04_mobile_view.png"), full_page=True)
            ok = page.locator("input[type='email']").first.is_visible()
            rec("Mobile viewport renders", ok, "390x844", "04_mobile_view.png")
        except Exception as e:
            rec("Mobile viewport renders", False, str(e))

        # 7 Network health
        print("\n-- 7. Network health --")
        rec("No 4xx/5xx on local origin", len(failed_reqs) == 0,
            f"{len(failed_reqs)} bad responses: {failed_reqs[:3]}")

        # 8 No uncaught JS errors
        print("\n-- 8. JS error hygiene --")
        crit_console = [c for c in console_msgs if c["type"] == "error"]
        rec("No pageerror exceptions", len(page_errors) == 0,
            f"{len(page_errors)} uncaught: {page_errors[:2]}")
        rec("No console.error entries", len(crit_console) == 0,
            f"{len(crit_console)} console errors")

        br.close()

    summary = {
        "total": len(results),
        "passed": sum(1 for r in results if r["status"] == "PASS"),
        "failed": sum(1 for r in results if r["status"] == "FAIL"),
        "results": results,
        "console_messages": console_msgs,
        "page_errors": page_errors,
    }
    (ART/"ui-smoke-results.json").write_text(json.dumps(summary, indent=2))
    print("\n=============================================")
    print(f"UI Smoke: {summary['passed']}/{summary['total']} passed | "
          f"{len(console_msgs)} console msgs | {len(page_errors)} page errors")
    print("=============================================")
    return 0

if __name__ == "__main__":
    sys.exit(run())
