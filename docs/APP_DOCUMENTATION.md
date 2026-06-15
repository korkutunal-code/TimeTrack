# TimeTrack - Complete Application Documentation

This document serves as the master reference for the TimeTrack application, detailing its functions, capabilities, rules, and frequently asked questions.

---

## 1. System Overview

TimeTrack is a secure, role-based web application designed to track employee work hours, enforce compliance (like California labor laws regarding lunch breaks), and streamline the payroll process for administrators.

**Core Technology Stack:**

* **Frontend:** React, Tailwind CSS, Vite
* **Backend:** Firebase (Authentication, Firestore Database, Hosting, Cloud Functions)
* **Notifications:** Brevo (Email), Twilio (SMS)

---

## 2. Roles & Permissions

The application operates on a strict three-tier role system:

### 🦸‍♂️ Admin (e.g., <torosasik@americantiledepot.com>)

* **Full System Access.**
* Add, edit, and deactivate users (Employees and Managers).
* Bulk import users via CSV.
* Edit any time entry for any user for any date.
* Lock and unlock payroll periods to prevent historical tampering.
* Approve or reject Employee Correction Requests.
* View global metrics and download payroll CSV exports.

### 👔 Manager

* View the "Team" dashboard to see today's live status of all employees.
* Approve or reject Employee Correction Requests.
* Manually edit time entries for employees under their supervision.
* View the "Audit" trail to see flagged/suspicious entries.
* *Cannot* lock payroll or manage system settings.
* *Cannot* add or delete users.

### 👷 Employee

* **Self-Service Only.** Can only view and interact with their own data.
* Clock IN, Lunch OUT, Lunch IN, and Clock OUT for the current day.
* View their historical time entries and total hours worked.
* Submit "Correction Requests" to managers if they made a mistake.
* *Cannot* freely edit past entries without manager approval.

---

## 3. Core Functions & Capabilities

### Time Entry Flow

The standard daily flow requires four sequential punches:

1. **Clock In:** Starts the day.
2. **Lunch Out:** Pauses the clock for a meal break.
3. **Lunch In:** Resumes the clock after the meal.
4. **Clock Out:** Ends the day and finalizes the total hours.

### Automated Anomaly Detection (Flags)

The system actively monitors time entries and flags them in the Manager/Admin Team Dashboard for review:

* **Missing Punches:** Employee forgot to clock out or return from lunch.
* **Short Lunch (< 30 mins):** Potential California labor law violation.
* **Long Lunch (> 60 mins):** Taking an excessively long break.
* **Late Entry:** Time entered after the 10:00 AM next-day deadline.
* **Suspicious Activity:** The employee frequently deletes/re-enters times or their entry timeline doesn't match standard sequential logic.

### Grace Periods & Restrictions

To maintain data integrity, the system enforces time limits:

* Employees are expected to complete their time card on the same calendar day.
* **The 10:00 AM Grace Period:** If an employee forgets to clock out, they have until 10:00 AM the *next morning* to fix it.
* **After 10:00 AM:** If they enter their time after 10:00 AM the next day, the system will accept it but tag it with a **Warning Bubble** and flag it for managers as a "Late Entry".
* **Incomplete Previous Days:** If an employee completely forgets to clock out yesterday, they are *reminded* via an amber warning bubble on their dashboard today, but they are *not blocked* from clocking in for their current shift. They must request a correction for the broken day.

### Manager Correction Requests

When an employee realizes they made a mistake (or forgot a punch from a previous day):

1. They go to their "History" tab and click the specific day.
2. They click "Request Manager Correction".
3. They input the *correct* times they meant to enter, and a note explaining why.
4. This request goes into the "Corrections" queue for Admins/Managers.
5. When a manager reviews it, they see a "Before vs. After" comparison. The manager can approve it (which overwrites the database) or reject it.

### Automatic Reminders (Cloud Functions)

The system runs an automated background check every day at **6:00 PM Pacific Time**.

* It scans all active employees who clocked IN today but haven't clocked OUT yet.
* It automatically sends an **Email** and **SMS Text Message** reminding them: *"TimeTrack Reminder: Please remember to clock out for the day."*

### Payroll Locking

Before exporting data to the payroll provider, an Admin can "Lock" the pay period up to a specific date (e.g., lock everything up to Sunday).

* Once locked, *nobody* (not even employees or managers) can alter time entries before that date.
* Correction requests for locked dates are automatically disabled.

---

## 4. Frequently Asked Questions (FAQs)

### For Employees

**Q: I skipped lunch today. How do I record this?**
A: After you Clock In, a secondary option appears below the main button: "Skip Lunch Break". Click this to bypass the Lunch Out/In requirements. *Note: Please ensure you have manager approval before skipping regular breaks.*

**Q: I forgot to clock out yesterday, and now my dashboard has a yellow warning bubble. What do I do?**
A: You can still clock in for today! However, your manager has been notified that yesterday's time card is broken. To fix it, go to your "History" tab, select yesterday, and submit a "Correction Request" with your actual clock-out time.

**Q: I lost my internet connection while trying to clock out.**
A: The system requires an internet connection to record secure timestamps. If you are offline, a red banner will appear at the top of your screen. Wait until your phone/computer reconnects to Wi-Fi or cellular data, and the banner will disappear, allowing you to submit.

**Q: Can I edit my time from last week?**
A: No. Employees cannot freely edit historical data to prevent unauthorized payroll changes. You must view the specific date in your History tab and use the "Request Manager Correction" feature.

### For Admins & Managers

**Q: What does the "Suspicious" flag mean in the Audit tab?**
A: The system marks an entry as suspicious if the system timestamps (when the user *actually* clicked the button) diverge wildly from the manual times they entered, or if the employee deleted and restarted their time card multiple times in one day to manipulate the system. It warrants a closer look by a manager.

**Q: An employee left the company. Should I delete their account?**
A: **NO.** Never delete an account if they have historical time entries, as it will corrupt your past payroll records. Instead, use the Admin Panel to edit their user profile and switch their status from "Active" to **"Deactivated"**. They will lose login access, but their history remains intact.

**Q: How do I export times for processing payroll?**
A: Go to the Admin -> Payroll tab. Select your Start Date and End Date. The system will calculate all regular hours for everyone. Click "Export CSV" to download a spreadsheet you can open in Excel or upload to your payroll provider. Before exporting, it is highly recommended to use the "Lock Pay Period" button to ensure no one changes their hours after you process them.
