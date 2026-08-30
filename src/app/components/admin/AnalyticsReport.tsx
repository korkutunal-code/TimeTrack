import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import { User } from '../../lib/auth';
import { SectionHelp } from '../ui/section-help';
import type { DocumentData } from 'firebase/firestore';
import { fetchGlobalSettings } from '../../../services/systemSettingsService';
import { fetchAttributedTimeEntries, projectOpenShiftsAt } from '../../../services/attributedEntries';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '../ui/select';
import { toast } from 'sonner';
import { FileText, Printer, Download, DollarSign, Clock, TrendingUp, Radio, Users, Flag, Percent, Activity } from 'lucide-react';
import { generateCSV, downloadCSV } from '../../../services/exportService';
import { ALL_USERS, USER_GROUP_OPTIONS } from '../../../utils/userSelection';
import { DailyBreakdownTable } from './DailyBreakdownTable';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - JS module
import { calculateBiweeklyOvertimeTotals, formatMinutesToHHMM } from '../../../utils/overtimeCalculations.js';
import type { OvertimeEntry } from '../../../utils/overtimeCalculations';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - JS module
import { formatDateShortWithWeekday } from '../../../utils/dateHelpers.js';
import { epochFromLocalWallTime, getCurrentPTDate, getEmployeeTimezone } from '../../../utils/timeCalculations';
import { getSegmentFlags, getParentRowFlags, FLAG_LABELS, FLAG_SEVERITY } from '../../../utils/analyticsFlags';
import { listWorkModels, type WorkModel as WorkModelDef } from '../../../services/workModelsService';
import { type TimeViewMode, displayTimeForView, zoneForMode, calendarDayOffsetInZone } from '../../../utils/timeView';

// Uniform chip geometry for every pill rendered inside Daily Breakdown rows
// (status badges, missing-lunch marker, flag chips). h-4 + leading-none makes
// each chip exactly 16px tall — identical to the text-xs line box of plain
// cells — so chip rows and plain-text rows share the same baseline height and
// a row only grows when flag chips wrap to a second line.
const CHIP_CLASS =
  'inline-flex items-center h-4 whitespace-nowrap rounded border px-1.5 leading-none';

interface AnalyticsReportProps {
  allUsers: User[];
  /** The signed-in user (drives admin-only Bulk Edit in Daily Breakdown). */
  currentUser: User;
  /**
   * Admin timezone view (Req 4). 'local' = employee local tz (default),
   * 'pt' = America/Los_Angeles. Display-only; conversion uses the absolute
   * epoch system timestamps so stored data is never mutated.
   */
  timeViewMode?: TimeViewMode;
}

interface PayrollSummary {
  userId: string;
  userName: string;
  workModel: string;
  /** Direct HH:MM duration strings (e.g. '97:12') from the OT pipeline. */
  regularHours: string;
  overtimeHours: string;
  doubleTimeHours: string;
  totalHours: string;
  dailyEntries?: DocumentData[];
}

export function AnalyticsReport({ allUsers, currentUser, timeViewMode = 'local' }: AnalyticsReportProps) {
  const [selectedUserId, setSelectedUserId] = useState<string>(ALL_USERS);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [report, setReport] = useState<PayrollSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  // Per-user resolved work-model definition (drives the Bulk Edit live OT
  // preview in DailyBreakdownTable). Captured during generateReport.
  const [workModelByUser, setWorkModelByUser] = useState<Map<string, WorkModelDef | null>>(new Map());
  // Live Bulk Edit preview totals reported up from DailyBreakdownTable while
  // the admin edits (null = not editing). Direct HH:MM strings, matching the
  // summary object's display format. The employee summary card swaps to these
  // so the totals update dynamically BEFORE the batch save.
  const [liveTotalsByUser, setLiveTotalsByUser] = useState<Map<string, { regularHours: string; overtimeHours: string; doubleTimeHours: string; totalHours: string } | null>>(new Map());
  // Daily Breakdown: merged view always shows the flag chips AND the
  // Reg/OT/DT metric columns computed from the pipeline entries
  // (utils/analyticsFlags.ts).
  const [payrollSettings, setPayrollSettings] = useState({
    payroll_cycle_type: 'biweekly',
    weekly_start_day: 1,
    biweekly_start_date: '2024-01-01',
    monthly_start_day: 1,
    exclude_records_before_date: '',
    // Automated Actions guardrails — drive the open-shift lunch projection
    // policy (under max = actual elapsed; at/over max = recorded cap).
    onsiteLunchMaxMinutes: 120,
    onsiteLunchRecordedMinutes: 60,
  });
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        // Read-through fallback: honors systemSettings/global, falling back to
        // the legacy reminders/payroll docs when global isn't migrated yet.
        const s = await fetchGlobalSettings();
        if (s) {
          setPayrollSettings({
            payroll_cycle_type: s.payroll_cycle_type,
            weekly_start_day: s.weekly_start_day,
            biweekly_start_date: s.biweekly_start_date,
            monthly_start_day: s.monthly_start_day,
            exclude_records_before_date: s.exclude_records_before_date || '',
            onsiteLunchMaxMinutes: s.onsiteLunchMaxMinutes,
            onsiteLunchRecordedMinutes: s.onsiteLunchRecordedMinutes,
          });
        }
      } catch (err) {
        console.error('Failed to load payroll settings', err);
      } finally {
        setSettingsLoaded(true);
      }
    };
    loadSettings();
  }, []);

  const cycleType = payrollSettings.payroll_cycle_type;

  /**
   * Pure helper: compute the start/end YMD strings for a given preset
   * ('current' | 'last') based on the loaded payroll settings.
   *
   * Anchor "today" in PT (America/Los_Angeles): admin payroll cycle
   * boundaries run in PT per AGENTS.md. The previous toISOString() slice
   * anchored to the browser-local UTC day, which can be one calendar day
   * ahead of PT between ~16:00 PST / 17:00 PDT and UTC midnight — landing
   * the Current/Last Cycle presets on the wrong block.
   */
  const computeCycleDates = useCallback((preset: 'current' | 'last'): { start: string; end: string } => {
    const todayYmd = getCurrentPTDate();

    if (cycleType === 'weekly') {
      // Bug fix: was `today.getDay()` (local TZ) — inconsistent for non-UTC users.
      // Now derived from a PT-anchored YMD with UTC math so the week boundary
      // is stable.
      const [ty, tm, td] = todayYmd.split('-').map(Number);
      const day = new Date(Date.UTC(ty, tm - 1, td)).getUTCDay();
      const startDay = payrollSettings.weekly_start_day;
      const diff = day >= startDay ? day - startDay : 7 - (startDay - day);

      const currentStart = new Date(Date.UTC(ty, tm - 1, td - diff));
      const currentEnd = new Date(currentStart);
      currentEnd.setUTCDate(currentStart.getUTCDate() + 6);

      if (preset === 'current') {
        return { start: currentStart.toISOString().slice(0, 10), end: currentEnd.toISOString().slice(0, 10) };
      } else {
        const lastStart = new Date(currentStart);
        lastStart.setUTCDate(lastStart.getUTCDate() - 7);
        const lastEnd = new Date(lastStart);
        lastEnd.setUTCDate(lastStart.getUTCDate() + 6);
        return { start: lastStart.toISOString().slice(0, 10), end: lastEnd.toISOString().slice(0, 10) };
      }
    } else if (cycleType === 'biweekly' || cycleType === 'custom') {
      // Use anchor date to determine current biweekly block
      let anchorStr = payrollSettings.biweekly_start_date;
      if (!anchorStr) anchorStr = '2024-01-01';
      // UTC-anchored to avoid local-TZ drift
      const [ay, am, ad] = anchorStr.split('-').map(Number);
      const anchor = new Date(Date.UTC(ay, am - 1, ad));

      const [ty, tm, td] = todayYmd.split('-').map(Number);
      const todayUtc = new Date(Date.UTC(ty, tm - 1, td));

      const diffTime = todayUtc.getTime() - anchor.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      const cyclesPassed = Math.floor(diffDays / 14);
      const currentStart = new Date(anchor);
      currentStart.setUTCDate(anchor.getUTCDate() + (cyclesPassed * 14));
      const currentEnd = new Date(currentStart);
      currentEnd.setUTCDate(currentStart.getUTCDate() + 13);

      if (preset === 'current') {
        return { start: currentStart.toISOString().slice(0, 10), end: currentEnd.toISOString().slice(0, 10) };
      } else {
        const lastStart = new Date(currentStart);
        lastStart.setUTCDate(lastStart.getUTCDate() - 14);
        const lastEnd = new Date(lastStart);
        lastEnd.setUTCDate(lastStart.getUTCDate() + 13);
        return { start: lastStart.toISOString().slice(0, 10), end: lastEnd.toISOString().slice(0, 10) };
      }
    } else if (cycleType === 'monthly') {
      // Configurable monthly cycle anchored on monthly_start_day (1–28).
      // Previously this hardcoded the 1st of the calendar month using
      // browser-local Date (TZ bug). Now UTC-anchored (matching the weekly/
      // biweekly branches) and derived from the configured start day.
      const startDay = Math.min(28, Math.max(1, payrollSettings.monthly_start_day || 1));
      const [ty, tm, td] = todayYmd.split('-').map(Number);

      // Cycle start = day `startDay` of the month containing today's cycle.
      // If today's day-of-month is before the anchor day, the cycle began
      // in the previous month.
      let startY = ty;
      let startM0 = tm - 1; // 0-indexed
      if (td < startDay) {
        if (startM0 === 0) { startM0 = 11; startY -= 1; }
        else startM0 -= 1;
      }
      const currentStart = new Date(Date.UTC(startY, startM0, startDay));

      // End = one day before the next cycle start (day before next month's
      // anchor day). nextStart uses startM0+1 (normalized by Date.UTC).
      const nextStart = new Date(Date.UTC(startY, startM0 + 1, startDay));
      const currentEnd = new Date(nextStart);
      currentEnd.setUTCDate(nextStart.getUTCDate() - 1);

      if (preset === 'current') {
        return { start: currentStart.toISOString().slice(0, 10), end: currentEnd.toISOString().slice(0, 10) };
      } else {
        // Last cycle = one month before the current cycle.
        let lastStartY = startY;
        let lastStartM0 = startM0 - 1;
        if (lastStartM0 < 0) { lastStartM0 = 11; lastStartY -= 1; }
        const lastStart = new Date(Date.UTC(lastStartY, lastStartM0, startDay));
        const lastEnd = new Date(currentStart);
        lastEnd.setUTCDate(currentStart.getUTCDate() - 1);
        return { start: lastStart.toISOString().slice(0, 10), end: lastEnd.toISOString().slice(0, 10) };
      }
    }
    // Fallback: return today's date for both
    return { start: todayYmd, end: todayYmd };
  }, [cycleType, payrollSettings.weekly_start_day, payrollSettings.biweekly_start_date, payrollSettings.monthly_start_day]);

  const setQuickPeriod = (preset: 'current' | 'last') => {
    const { start, end } = computeCycleDates(preset);
    setStartDate(start);
    setEndDate(end);
  };

  const generateReport = useCallback(async () => {
    if (!startDate || !endDate) {
      toast.error('Please select start and end dates');
      return;
    }

    setLoading(true);
    try {
      // Load work models once for per-user OT rule resolution.
      // (List is small; safe to fetch in full each report run.)
      const workModelList = await listWorkModels();
      const workModelById = new Map<string, WorkModelDef>(workModelList.map(m => [m.id, m]));

      // Pull entries through the Analytics read pipeline (same query shape,
      // exclusion cutoff, segment rebuild, cross-midnight attribution, and
      // role narrowing as Payroll) — EXCEPT completeOnly: false so open /
      // incomplete shifts are included.
      const attributed = await fetchAttributedTimeEntries({
        startDate,
        endDate,
        selectedUserId,
        allUsers,
        completeOnly: false,
        excludeBefore: payrollSettings.exclude_records_before_date,
      });

      // IN-MEMORY virtual closure: open shifts are projected forward to the
      // current moment so their accumulated hours count toward totals and OT.
      // Strictly read-side — nothing here is ever persisted to Firestore.
      // Lunch projection mirrors the autoGuardrails cron: under the max-open
      // threshold the actual elapsed lunch is deducted; at/over it the
      // deduction caps to the recorded minutes.
      const dateAttributedEntries = projectOpenShiftsAt(attributed, Date.now(), {
        lunchMaxMinutes: payrollSettings.onsiteLunchMaxMinutes,
        lunchRecordedMinutes: payrollSettings.onsiteLunchRecordedMinutes,
      });

      // Group by employee and calculate biweekly overtime totals (California rules)
      const byUser = new Map<string, OvertimeEntry[]>();
      dateAttributedEntries.forEach(e => {
        const uid = String(e.userId || '');
        if (!byUser.has(uid)) byUser.set(uid, []);
        byUser.get(uid)!.push(e as OvertimeEntry);
      });

      const summaries: PayrollSummary[] = [];
      const wmByUser = new Map<string, WorkModelDef | null>();
      for (const [userId, entries] of byUser.entries()) {
        const userObj = allUsers.find(u => u.uid === userId);
        const userWorkModel = userObj?.workModelId ? workModelById.get(userObj.workModelId) ?? null : null;
        const userOverride = userObj?.workModelOverride ?? null;
        wmByUser.set(userId, userWorkModel);
        const ot = calculateBiweeklyOvertimeTotals(entries, payrollSettings.weekly_start_day, userWorkModel, userOverride);
        summaries.push({
          userId,
          userName: allUsers.find(u => u.uid === userId)?.name || 'Unknown',
          workModel: userWorkModel?.name || userObj?.workModel || 'On-site',
          // Direct HH:MM outputs calculated from the raw minute totals.
          regularHours: formatMinutesToHHMM(ot.grandTotals.regularMinutes || 0),
          overtimeHours: formatMinutesToHHMM(ot.grandTotals.otMinutes || 0),
          doubleTimeHours: formatMinutesToHHMM(ot.grandTotals.doubleTimeMinutes || 0),
          totalHours: formatMinutesToHHMM(ot.grandTotals.totalMinutes || 0),
          dailyEntries: ot.adjustedEntries.sort((a, b) => b.workDate.localeCompare(a.workDate))
        });
      }

      // Primary: alphabetical. Secondary (stable group pass): on-site above
      // remote. Array.prototype.sort is stable (ES2019+), so a group-only
      // comparator preserves the alphabetical order within each group.
      summaries.sort((a, b) => a.userName.localeCompare(b.userName));
      summaries.sort((a, b) => (a.workModel === 'On-site' ? 0 : 1) - (b.workModel === 'On-site' ? 0 : 1));
      setWorkModelByUser(wmByUser);
      setReport(summaries);
      toast.success('Report generated');
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, selectedUserId, allUsers, payrollSettings.weekly_start_day, payrollSettings.exclude_records_before_date, payrollSettings.onsiteLunchMaxMinutes, payrollSettings.onsiteLunchRecordedMinutes]);

  // Auto-initialize dates to Current Cycle on mount (after settings load).
  // The state change re-triggers the debounced auto-refresh effect below,
  // which is the single source of report runs — calling generateReport()
  // directly here too would double-fetch (the setState fires the debounce).
  useEffect(() => {
    if (!settingsLoaded) return;
    const { start, end } = computeCycleDates('current');
    // Defer setState to avoid cascading renders (React ESLint rule).
    setTimeout(() => {
      setStartDate(start);
      setEndDate(end);
    }, 0);
  }, [settingsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced auto-refresh: re-run the report whenever any control changes.
  // allUsers is included so a report that ran while the user list was still
  // loading (empty) re-syncs once profiles resolve — otherwise names, work
  // models, and role-group membership stay stale until the next control
  // change or a full page refresh.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitialMount = useRef(true);
  useEffect(() => {
    // Skip the very first render — the mount effect above already handles it.
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (!startDate || !endDate) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      generateReport();
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [startDate, endDate, selectedUserId, allUsers]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportCSV = () => {
    if (!report) return;

    const headers = ['Employee', 'Regular Hours', 'Overtime (1.5x)', 'Double Time (2x)', 'Total Hours'];
    // Values are already direct HH:MM strings from the calculation pipeline.
    const rows = report.map(r => [
      r.userName,
      r.regularHours,
      r.overtimeHours,
      r.doubleTimeHours,
      r.totalHours,
    ]);

    const csvContent = generateCSV(headers, rows);
    downloadCSV(`analytics-report-${startDate}-to-${endDate}`, csvContent);
    toast.success('CSV exported');
  };

  const printReport = () => {
    window.print();
  };

  // Cross-employee totals: aggregate each day's RAW MINUTES (HH:MM strings
  // can't be summed), then format the final sums as HH:MM.
  const totalRegular = formatMinutesToHHMM(
    report?.reduce((acc, r) => acc + (r.dailyEntries ?? []).reduce((s, d) => s + (d.regularMinutes || 0), 0), 0) || 0);
  const totalOvertime = formatMinutesToHHMM(
    report?.reduce((acc, r) => acc + (r.dailyEntries ?? []).reduce((s, d) => s + (d.otMinutes || 0), 0), 0) || 0);
  const totalDouble = formatMinutesToHHMM(
    report?.reduce((acc, r) => acc + (r.dailyEntries ?? []).reduce((s, d) => s + (d.doubleTimeMinutes || 0), 0), 0) || 0);
  const grandTotal = formatMinutesToHHMM(
    report?.reduce((acc, r) => acc + (r.dailyEntries ?? []).reduce((s, d) => s + (d.totalWorkMinutes || 0), 0), 0) || 0);

  // Multi-shift aggregation for the Daily Breakdown table. A day's `segments[]`
  // (if present) holds the individual shifts; the parent row must reflect the
  // day's earliest clock-in, latest clock-out, and aggregated lunch breaks —
  // not the entry-level fields, which may hold the wrong shift's value.
  //
  // Multi-day / cross-midnight handling: segment manual times are stored as
  // "HH:MM" strings with no date. To order them across midnight AND across
  // multiple calendar days we prefer the epoch-ms `clockInSystem` /
  // `clockOutSystem` fields (the true wall-clock instants). The calendar-day
  // offset of each timestamp relative to the shift's clock-in is rendered as a
  // dynamic "+Nd" badge (e.g. +2d for a 48-72h span). Manual-only segments
  // (no system timestamps) fall back to the single-day wrap heuristic and can
  // only detect a +1d boundary.
  interface TimeBoundary {
    time?: string;
    /** Absolute epoch-ms system timestamp for the boundary (when known). Used
     * by the admin timezone view (Req 4) to convert to local/PT for display. */
    ms?: number;
    dayOffset: number; // calendar days after the anchor (0 = same day, 1 = next, 2 = +2d, …)
  }

  const toMinutes = (t: string | undefined | null): number => {
    if (!t) return NaN;
    const parts = String(t).split(':').map(Number);
    if (parts.length !== 2 || Number.isNaN(parts[0]) || Number.isNaN(parts[1])) return NaN;
    return parts[0] * 60 + parts[1];
  };

  // Calendar-day difference between two epoch-ms instants, computed in the
  // DISPLAY zone (the zone the row's times are rendered in — employee local
  // for the 'local' view, PT for the 'pt' view). The badge zone must match
  // the display zone: comparing PT dates while rendering local times produced
  // false-positive +1d badges on same-local-day shifts that merely straddled
  // the PT midnight (e.g. 12:00 AM → 11:59 PM local).
  const dayOffsetFromSystem = (anchorMs: number, targetMs: number, zone: string): number =>
    calendarDayOffsetInZone(anchorMs, targetMs, zone);

  const getDayBoundaries = (day: DocumentData, zone: string): { clockIn?: TimeBoundary; clockOut?: TimeBoundary } => {
    const segs = day.segments;
    if (!Array.isArray(segs) || segs.length === 0) {
      // Legacy single-shift doc.
      const inMs = typeof day.clockInSystem === 'number' ? day.clockInSystem : undefined;
      const outMs = typeof day.clockOutSystem === 'number' ? day.clockOutSystem : undefined;
      let outOffset = 0;
      if (inMs !== undefined && outMs !== undefined) {
        outOffset = dayOffsetFromSystem(inMs, outMs, zone);
      } else {
        const inM = toMinutes(day.clockInManual);
        const outM = toMinutes(day.clockOutManual);
        outOffset = !Number.isNaN(inM) && !Number.isNaN(outM) && outM < inM ? 1 : 0;
      }
      return {
        clockIn: { time: day.clockInManual, ms: inMs, dayOffset: 0 },
        clockOut: { time: day.clockOutManual, ms: outMs, dayOffset: outOffset },
      };
    }
    // Earliest clock-in and latest clock-out across all segments. All
    // candidates are normalized to ONE unit (epoch ms) before comparing:
    // manual-only HH:MM strings are anchored to the row's workDate in the
    // display zone via epochFromLocalWallTime (wrapFrom the clock-in for
    // clock-outs). The previous `inMs ?? inM` mixed epoch-ms (~1.7e12) with
    // minutes-of-day (0–1440) in a single </> comparison, silently dropping
    // manual-only segments from the aggregate In/Out whenever any sibling
    // segment carried a *System timestamp.
    let earliest: { time: string; ms?: number; absMs: number } | null = null;
    let latest: { time: string; ms?: number; absMs: number } | null = null;
    for (const s of segs) {
      const inMs = typeof s.clockInSystem === 'number' ? s.clockInSystem : undefined;
      const inAbsMs = inMs ?? epochFromLocalWallTime(s.clockInManual, day.workDate, zone) ?? NaN;
      if (!Number.isNaN(inAbsMs) && (!earliest || inAbsMs < earliest.absMs)) {
        earliest = { time: s.clockInManual, ms: inMs, absMs: inAbsMs };
      }
      const outMs = typeof s.clockOutSystem === 'number' ? s.clockOutSystem : undefined;
      const outAbsMs =
        outMs ??
        epochFromLocalWallTime(s.clockOutManual, day.workDate, zone, s.clockInManual) ??
        NaN;
      if (!Number.isNaN(outAbsMs) && (!latest || outAbsMs > latest.absMs)) {
        latest = { time: s.clockOutManual, ms: outMs, absMs: outAbsMs };
      }
    }
    // Day offset for the latest clock-out relative to the earliest clock-in —
    // both anchors are epoch ms now, so the same zone-aware calendar
    // comparison covers system, manual, and mixed rows alike.
    const outOffset =
      earliest && latest ? Math.max(0, dayOffsetFromSystem(earliest.absMs, latest.absMs, zone)) : 0;
    return {
      clockIn: earliest ? { time: earliest.time, ms: earliest.ms, dayOffset: 0 } : undefined,
      clockOut: latest ? { time: latest.time, ms: latest.ms, dayOffset: outOffset } : undefined,
    };
  };

  // 3-way lunch summary: 0 breaks → none; 1 break → its times; 2+ → multiple.
  // dayOffset for a break is relative to the owning segment's clock-in.
  const getDayLunch = (day: DocumentData, zone: string): { lunchOut?: TimeBoundary; lunchIn?: TimeBoundary; isMultiple: boolean } => {
    const segs = day.segments;
    if (!Array.isArray(segs) || segs.length === 0) {
      const hasBreak = !!day.lunchOutManual && !!day.lunchInManual;
      if (!hasBreak) return { isMultiple: false };
      const inMs = typeof day.clockInSystem === 'number' ? day.clockInSystem : undefined;
      const loMs = typeof day.lunchOutSystem === 'number' ? day.lunchOutSystem : undefined;
      const liMs = typeof day.lunchInSystem === 'number' ? day.lunchInSystem : undefined;
      const inM = toMinutes(day.clockInManual);
      const loM = toMinutes(day.lunchOutManual);
      const liM = toMinutes(day.lunchInManual);
      const loOffset = inMs !== undefined && loMs !== undefined ? dayOffsetFromSystem(inMs, loMs, zone)
        : (!Number.isNaN(inM) && !Number.isNaN(loM) && loM < inM ? 1 : 0);
      const liOffset = inMs !== undefined && liMs !== undefined ? dayOffsetFromSystem(inMs, liMs, zone)
        : (!Number.isNaN(inM) && !Number.isNaN(liM) && liM < inM ? 1 : 0);
      return {
        lunchOut: { time: day.lunchOutManual, ms: loMs, dayOffset: loOffset },
        lunchIn: { time: day.lunchInManual, ms: liMs, dayOffset: liOffset },
        isMultiple: false,
      };
    }
    const breaks: { lunchOut: TimeBoundary; lunchIn: TimeBoundary }[] = [];
    for (const s of segs) {
      if (s.skipLunch || !s.lunchOutManual || !s.lunchInManual) continue;
      const inMs = typeof s.clockInSystem === 'number' ? s.clockInSystem : undefined;
      const loMs = typeof s.lunchOutSystem === 'number' ? s.lunchOutSystem : undefined;
      const liMs = typeof s.lunchInSystem === 'number' ? s.lunchInSystem : undefined;
      const inM = toMinutes(s.clockInManual);
      const loM = toMinutes(s.lunchOutManual);
      const liM = toMinutes(s.lunchInManual);
      const loOffset = inMs !== undefined && loMs !== undefined ? dayOffsetFromSystem(inMs, loMs, zone)
        : (!Number.isNaN(inM) && !Number.isNaN(loM) && loM < inM ? 1 : 0);
      const liOffset = inMs !== undefined && liMs !== undefined ? dayOffsetFromSystem(inMs, liMs, zone)
        : (!Number.isNaN(inM) && !Number.isNaN(liM) && liM < inM ? 1 : 0);
      breaks.push({
        lunchOut: { time: s.lunchOutManual, ms: loMs, dayOffset: loOffset },
        lunchIn: { time: s.lunchInManual, ms: liMs, dayOffset: liOffset },
      });
    }
    if (breaks.length === 0) return { isMultiple: false };
    if (breaks.length === 1) {
      return { lunchOut: breaks[0].lunchOut, lunchIn: breaks[0].lunchIn, isMultiple: false };
    }
    return { isMultiple: true };
  };

  // Calendar-day offset for a single segment field, relative to that segment's
  // clock-in. Uses system timestamps when present (handles +Nd), else the
  // single-day manual heuristic (0 or 1).
  const segFieldDayOffset = (
    seg: DocumentData,
    field: 'clockOutManual' | 'lunchOutManual' | 'lunchInManual',
    zone: string,
  ): number => {
    const inMs = typeof seg.clockInSystem === 'number' ? seg.clockInSystem : undefined;
    const sysField = field === 'clockOutManual' ? 'clockOutSystem'
      : field === 'lunchOutManual' ? 'lunchOutSystem'
      : 'lunchInSystem';
    const tMs = typeof seg[sysField] === 'number' ? seg[sysField] : undefined;
    if (inMs !== undefined && tMs !== undefined) {
      return Math.max(0, dayOffsetFromSystem(inMs, tMs, zone));
    }
    const inM = toMinutes(seg.clockInManual);
    const t = toMinutes(seg[field]);
    if (Number.isNaN(inM) || Number.isNaN(t)) return 0;
    return t < inM ? 1 : 0;
  };

  const fmtTime = (t: string | undefined): string => {
    if (!t) return '--';
    const [h, m] = t.split(':');
    const hour = parseInt(h, 10);
    if (Number.isNaN(hour)) return '--';
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const dh = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    return `${dh}:${m} ${ampm}`;
  };

  // Resolved work-model definition for a given employee (drives the Bulk Edit
  // live OT preview). Populated during generateReport; falls back to null
  // (CA defaults) when the report hasn't run yet.
  const workModelByIdForUser = (uid: string): WorkModelDef | null =>
    workModelByUser.get(uid) ?? null;

  // Dynamic day-offset badge: "+1d", "+2d", "+3d" … rendered when a timestamp
  // falls on a later calendar day than its shift's clock-in. Used in both the
  // parent summary row and the per-shift sub-rows.
  const DayOffsetBadge = ({ offset }: { offset: number }) => (
    <span className="inline-flex items-center rounded bg-purple-100 px-1 text-xs font-medium leading-none text-purple-700">
      +{offset}d
    </span>
  );
  const fmtBoundary = (b: TimeBoundary | undefined, empTz?: string): JSX.Element => {
    if (!b || !b.time) return <span>--</span>;
    // Admin timezone view (Req 4): when the absolute epoch-ms timestamp is
    // known, render it converted to the selected view zone (employee local or
    // PT). Falls back to the stored manual string for legacy rows without ms.
    const shown = displayTimeForView(b.ms, b.time, timeViewMode, empTz) ?? b.time;
    return (
      <span className="inline-flex items-center gap-1.5 leading-none">
        {fmtTime(shown)}
        {b.dayOffset > 0 && <DayOffsetBadge offset={b.dayOffset} />}
      </span>
    );
  };

  // Live name resolution: userName is baked into the report at generation
  // time, but allUsers may still have been empty then (async load race in
  // App.tsx). Resolve against the live list at render so late-arriving
  // profiles self-heal without a manual refresh; the generated value is the
  // fallback.
  const resolveUserName = useCallback(
    (summary: PayrollSummary): string =>
      allUsers.find(u => u.uid === summary.userId)?.name || summary.userName,
    [allUsers],
  );

  // The full parent-row flag set for one day — the SAME computation the
  // Daily Breakdown renders (child segment flags + day-level + missing_lunch).
  // Extracted so the Flags Statistics summary counts exactly what the table
  // shows (SSOT: utils/analyticsFlags.ts, no separate Metrics-tab mechanics).
  const computeDayFlags = (summary: PayrollSummary, day: DocumentData): string[] => {
    const viewZone = zoneForMode(timeViewMode, getEmployeeTimezone(allUsers.find(u => u.uid === summary.userId)?.timezone));
    const lunch = getDayLunch(day, viewZone);
    const isOnsite = summary.workModel === 'On-site';
    const lunchMissing = isOnsite && !lunch.isMultiple && !lunch.lunchOut && !lunch.lunchIn;
    const segs = Array.isArray(day.segments) ? day.segments : [];
    const flagSegs: DocumentData[] = segs.length > 0 ? segs : [day];
    const childFlags: string[][] = flagSegs.map((s, i) =>
      getSegmentFlags(s, {
        isLastSegment: i === flagSegs.length - 1,
        docAutoClosed: day.autoClosed === true,
        docAutoEndedLunch: day.autoEndedLunch === true,
        docAnomaly: day.anomaly_flag === true,
        completedAt: day.completedAt,
        isOnSite: isOnsite,
      }),
    );
    return getParentRowFlags(day, childFlags, lunchMissing ? ['missing_lunch'] : []);
  };

  // Flags Statistics — computed from the generated report's pipeline entries.
  // Also produces the per-employee distribution + per-flag-type frequencies
  // for the two tables below; all from the SAME computeDayFlags SSOT.
  const flagStats = useMemo(() => {
    if (!report) return null;
    const recordedEmployees = report.length;
    let totalEntries = 0;
    let flaggedEntries = 0;
    let totalFlags = 0;
    const flagTypeCounts = new Map<string, number>();
    const employeeDist: {
      userId: string;
      userName: string;
      totalEntries: number;
      flaggedEntries: number;
      totalFlags: number;
      flagRate: number;
      riskLevel: 'high' | 'medium' | 'low';
    }[] = [];

    for (const summary of report) {
      let empEntries = 0;
      let empFlagged = 0;
      let empFlags = 0;
      for (const day of summary.dailyEntries ?? []) {
        empEntries += 1;
        const flags = computeDayFlags(summary, day);
        if (flags.length > 0) empFlagged += 1;
        empFlags += flags.length;
        for (const f of flags) flagTypeCounts.set(f, (flagTypeCounts.get(f) ?? 0) + 1);
      }
      totalEntries += empEntries;
      flaggedEntries += empFlagged;
      totalFlags += empFlags;
      const flagRate = empEntries > 0 ? (empFlagged / empEntries) * 100 : 0;
      employeeDist.push({
        userId: summary.userId,
        userName: resolveUserName(summary),
        totalEntries: empEntries,
        flaggedEntries: empFlagged,
        totalFlags: empFlags,
        flagRate,
        riskLevel: flagRate > 30 ? 'high' : flagRate > 15 ? 'medium' : 'low',
      });
    }

    employeeDist.sort((a, b) => b.flagRate - a.flagRate);
    const flagFrequencies = [...flagTypeCounts.entries()]
      .map(([flag, count]) => ({ flag, count }))
      .sort((a, b) => b.count - a.count);

    return {
      recordedEmployees,
      totalEntries,
      flaggedEntries,
      totalFlags,
      flaggedRate: totalEntries > 0 ? (flaggedEntries / totalEntries) * 100 : 0,
      flagsPerFlaggedEntry: flaggedEntries > 0 ? totalFlags / flaggedEntries : 0,
      employeeDist,
      flagFrequencies,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, allUsers, timeViewMode, resolveUserName]);

  // Render flag chips for the Flags view. Empty flag list → null (clean cell).
  const renderFlagChips = (flags: string[]): JSX.Element | null => {
    if (flags.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-1 items-center">
        {flags.map((f) => {
          const sev = FLAG_SEVERITY[f] ?? 'amber';
          const cls =
            sev === 'red' ? 'bg-red-100 text-red-700 border-red-200'
              : sev === 'purple' ? 'bg-purple-100 text-purple-700 border-purple-200'
                : 'bg-amber-100 text-amber-700 border-amber-200';
          return (
            <span key={f} className={`${CHIP_CLASS} text-[10px] font-medium ${cls}`}>
              {FLAG_LABELS[f] ?? f.replace(/_/g, ' ')}
            </span>
          );
        })}
      </div>
    );
  };

  // Open (still-active) shifts included via the in-memory now-projection —
  // surfaced in the UI so admins know those hours are live estimates.
  const openShiftCount = report
    ? report.reduce((n, s) => n + (s.dailyEntries ?? []).filter(d => d.projectedOpen).length, 0)
    : 0;

  return (
    <div className="space-y-4">
      {/* Report Setup Card */}
      <Card className="border-2 border-slate-200 gap-3">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <FileText className="size-5" />
            Analytics Report Setup
            {loading && <span className="text-xs font-normal text-blue-600 animate-pulse ml-2">Refreshing…</span>}
          </CardTitle>
          <SectionHelp
            title="Analytics"
            description="Generates summary reports regarding accumulated aggregates across cycle nodes."
            sections={[
              { title: "Setup View", content: "Filter by User and Period thresholds to accumulate total intervals." },
              { title: "Details Breakdowns", content: "Click 'View Details' on card objects to expand precise timestamp rows grids." },
              { title: "Cycle Configuration", content: "Admin adjusts defaults cycle types in global System Settings." }
            ]}
          />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Employee</Label>
              <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USER_GROUP_OPTIONS.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                  <SelectSeparator />
                  {allUsers.map(u => (
                    <SelectItem key={u.uid} value={u.uid}>{u.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Start Date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">End Date</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-10"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs invisible">Cycle</Label>
              <Button variant="outline" onClick={() => setQuickPeriod('current')} className="w-full h-10 text-xs">
                Current On-Site Cycle
              </Button>
            </div>
            <div className="space-y-1">
              <Label className="text-xs invisible">Cycle</Label>
              <Button variant="outline" onClick={() => setQuickPeriod('last')} className="w-full h-10 text-xs">
                Last On-Site Cycle
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report Results */}
      {report && (
        <>
          {/* Summary Stats + Actions */}
          <div className="flex flex-row items-center gap-4 w-full">
            <div className="flex-1 grid grid-cols-4 gap-3">
              <Card className="border-2 border-blue-100 bg-gradient-to-br from-white to-blue-50">
                <CardContent className="py-2 px-3.5 [&:last-child]:pb-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-blue-100 p-2.5 rounded-lg">
                      <Clock className="size-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-600">Regular</p>
                      <p className="text-2xl font-bold text-slate-900">{totalRegular}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-2 border-orange-100 bg-gradient-to-br from-white to-orange-50">
                <CardContent className="py-2 px-3.5 [&:last-child]:pb-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-orange-100 p-2.5 rounded-lg">
                      <TrendingUp className="size-5 text-orange-600" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-600">OT (1.5x)</p>
                      <p className="text-2xl font-bold text-slate-900">{totalOvertime}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-2 border-red-100 bg-gradient-to-br from-white to-red-50">
                <CardContent className="py-2 px-3.5 [&:last-child]:pb-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-red-100 p-2.5 rounded-lg">
                      <TrendingUp className="size-5 text-red-600" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-600">DT (2x)</p>
                      <p className="text-2xl font-bold text-slate-900">{totalDouble}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-2 border-green-100 bg-gradient-to-br from-white to-green-50">
                <CardContent className="py-2 px-3.5 [&:last-child]:pb-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-green-100 p-2.5 rounded-lg">
                      <DollarSign className="size-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-xs text-slate-600">Total</p>
                      <p className="text-2xl font-bold text-slate-900">{grandTotal}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="shrink-0 flex items-center gap-2">
              <Button variant="outline" onClick={printReport} className="h-10">
                <Printer className="size-4 mr-2" />
                Print
              </Button>
              <Button variant="outline" onClick={exportCSV} className="h-10">
                <Download className="size-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>

          {/* Open-shift projection notice */}
          {openShiftCount > 0 && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <Radio className="size-4 shrink-0" />
              <span>
                {openShiftCount} open shift{openShiftCount === 1 ? '' : 's'} included — hours are projected to the
                current moment (in-memory only; the database is not modified).
              </span>
            </div>
          )}

          {/* Employee Cards - Mobile Friendly */}
          <div className="space-y-2">
            {report.map((summary, idx) => {
              // Employee's local timezone for the Req-4 'local' view mode.
              const empTz = allUsers.find(u => u.uid === summary.userId)?.timezone;
              // The +Nd day-offset badges must be computed in the same zone the
              // times are displayed in, or same-local-day shifts that straddle
              // the PT midnight get a false-positive +1d badge.
              const viewZone = zoneForMode(timeViewMode, empTz);
              const hasOpenShift = (summary.dailyEntries ?? []).some(d => d.projectedOpen);
              // Divider between the on-site and remote groups: rendered once,
              // directly before the first remote employee (only when both
              // groups are present — i.e. the first remote is not at index 0).
              const showDivider = idx > 0 && summary.workModel !== 'On-site' && report[idx - 1].workModel === 'On-site';
              return (
              <Fragment key={summary.userId}>
              {showDivider && <hr className="my-4 border-t border-gray-200" />}
              <Card className="border-2 border-slate-200">
                <CardContent className="py-1 px-2 [&:last-child]:pb-1">
                  <div className="flex flex-row items-center justify-between gap-4 py-1 px-2">
                    {/* Left — employee info. Fixed width (w-[150px], not
                        min-w) so the In Progress badge can never widen the
                        block and shift the Regular/OT/DT boxes to the right;
                        the badge stacks as a third line below the Total text
                        instead of sitting inline with the name. The parent
                        row's items-center keeps the whole block vertically
                        centered against the metric boxes and View Details. */}
                    <div className="flex flex-col shrink-0 w-[150px]">
                      <h3 className="text-sm font-bold text-slate-900 truncate">{resolveUserName(summary)}</h3>
                      <p className="text-xs text-slate-400">Total: {liveTotalsByUser.get(summary.userId)?.totalHours ?? summary.totalHours} hours</p>
                      {hasOpenShift && (
                        // self-start: without it the column flexbox's default
                        // `align-items: stretch` stretches the chip to the
                        // block's full 150px; this shrink-wraps it to the
                        // text (~64px) with the left edge/text position
                        // unchanged.
                        <span className={`mt-0.5 self-start ${CHIP_CLASS} bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px] font-semibold`}>
                          In Progress
                        </span>
                      )}
                    </div>

                    {/* Center — metric boxes. During Bulk Edit these swap to
                        the live preview totals so the admin sees the impact of
                        pending edits before saving. Only the box whose value
                        actually CHANGED gets the amber warning fill; unchanged
                        boxes keep their default background. */}
                    {(() => {
                      const live = liveTotalsByUser.get(summary.userId) ?? null;
                      // HH:MM string comparison — both sides come from the same
                      // pipeline formatter, so !== is an exact change check.
                      const regChanged = !!live && live.regularHours !== summary.regularHours;
                      const otChanged = !!live && live.overtimeHours !== summary.overtimeHours;
                      const dtChanged = !!live && live.doubleTimeHours !== summary.doubleTimeHours;
                      const amberBox = 'bg-amber-100 border-amber-400 ring-1 ring-amber-300';
                      return (
                        <div className="flex-1 grid grid-cols-3 gap-3 items-center">
                          <div className={`py-1.5 px-3 rounded-lg border ${regChanged ? amberBox : 'bg-slate-50 border-slate-200'}`}>
                            <p className="text-xs text-slate-600 mb-0.5">Regular</p>
                            <p className="text-lg font-bold text-slate-900">{live?.regularHours ?? summary.regularHours}</p>
                          </div>
                          <div className={`py-1.5 px-3 rounded-lg border ${otChanged ? amberBox : 'bg-orange-50 border-orange-200'}`}>
                            <p className="text-xs text-orange-700 mb-0.5">OT 1.5x</p>
                            <p className="text-lg font-bold text-orange-700">{live?.overtimeHours ?? summary.overtimeHours}</p>
                          </div>
                          <div className={`py-1.5 px-3 rounded-lg border ${dtChanged ? amberBox : 'bg-red-50 border-red-200'}`}>
                            <p className="text-xs text-red-700 mb-0.5">DT 2x</p>
                            <p className="text-lg font-bold text-red-700">{live?.doubleTimeHours ?? summary.doubleTimeHours}</p>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Right — view details */}
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => setExpandedUserId(expandedUserId === summary.userId ? null : summary.userId)}
                      className="shrink-0 self-center text-xs font-semibold text-indigo-600 hover:underline p-0 h-auto"
                    >
                      {expandedUserId === summary.userId ? 'Hide Details' : 'View Details'}
                    </Button>
                  </div>

                  {expandedUserId === summary.userId && summary.dailyEntries && (
                    <DailyBreakdownTable
                      summary={summary}
                      currentUser={currentUser}
                      employeeTimezone={empTz}
                      workModelDef={workModelByIdForUser(summary.userId)}
                      workModelOverride={allUsers.find(u => u.uid === summary.userId)?.workModelOverride ?? null}
                      onSaved={generateReport}
                      onLiveTotals={(totals) =>
                        setLiveTotalsByUser(prev => {
                          const next = new Map(prev);
                          if (totals) next.set(summary.userId, totals);
                          else next.delete(summary.userId);
                          return next;
                        })
                      }
                      formatDate={(ymd: string) => formatDateShortWithWeekday(ymd)}
                      isMultiShift={(day: DocumentData) => (Array.isArray(day.segments) ? day.segments : []).length > 1}
                      segmentsOf={(day: DocumentData) => (Array.isArray(day.segments) ? day.segments : [])}
                      renderParentBoundary={(day: DocumentData, which: 'in' | 'out') => {
                        const b = getDayBoundaries(day, viewZone);
                        if (which === 'in') return fmtBoundary(b.clockIn, empTz);
                        return day.projectedOpen
                          ? <span className={`${CHIP_CLASS} bg-emerald-100 text-emerald-700 border-emerald-200 text-xs font-semibold`}>In Progress</span>
                          : fmtBoundary(b.clockOut, empTz);
                      }}
                      renderParentLunch={(day: DocumentData, which: 'out' | 'in') => {
                        const lunch = getDayLunch(day, viewZone);
                        const isOnsite = summary.workModel === 'On-site';
                        const lunchMissing = isOnsite && !lunch.isMultiple && !lunch.lunchOut && !lunch.lunchIn;
                        const boundary = which === 'out' ? lunch.lunchOut : lunch.lunchIn;
                        if (lunch.isMultiple) return <span className="italic text-slate-400">Multiple</span>;
                        if (lunchMissing) return <span className={`${CHIP_CLASS} bg-red-100 text-red-700 font-semibold border-red-200`}>--</span>;
                        return fmtBoundary(boundary, empTz);
                      }}
                      renderSegBoundary={(seg: DocumentData, field) => {
                        if (field === 'clockInManual') return fmtBoundary({ time: seg.clockInManual, ms: seg.clockInSystem, dayOffset: 0 }, empTz);
                        if (field === 'clockOutManual') {
                          return seg.projectedClosed
                            ? <span className={`${CHIP_CLASS} bg-emerald-100 text-emerald-700 border-emerald-200 text-xs font-semibold`}>now</span>
                            : fmtBoundary({ time: seg.clockOutManual, ms: seg.clockOutSystem, dayOffset: segFieldDayOffset(seg, 'clockOutManual', viewZone) }, empTz);
                        }
                        const sysField = field === 'lunchOutManual' ? 'lunchOutSystem' : 'lunchInSystem';
                        return fmtBoundary({ time: seg[field], ms: seg[sysField], dayOffset: segFieldDayOffset(seg, field, viewZone) }, empTz);
                      }}
                      renderParentFlags={(day: DocumentData) => renderFlagChips(computeDayFlags(summary, day))}
                      renderSegFlags={(day: DocumentData, index: number) => {
                        const segs = Array.isArray(day.segments) ? day.segments : [];
                        const flagSegs: DocumentData[] = segs.length > 0 ? segs : [day];
                        const flags = getSegmentFlags(flagSegs[index] ?? day, {
                          isLastSegment: index === flagSegs.length - 1,
                          docAutoClosed: day.autoClosed === true,
                          docAutoEndedLunch: day.autoEndedLunch === true,
                          docAnomaly: day.anomaly_flag === true,
                          completedAt: day.completedAt,
                          isOnSite: summary.workModel === 'On-site',
                        });
                        return renderFlagChips(flags);
                      }}
                    />
                  )}
                </CardContent>
              </Card>
              </Fragment>
              );
            })}
          </div>

          {/* Info Card */}
          <Card className="border-2 border-blue-200 bg-blue-50">
            <CardContent className="p-4">
              <p className="text-sm font-semibold text-blue-900 mb-2">California Overtime Rules Applied for On-site Employees</p>
              <div className="text-sm text-blue-800 space-y-1">
                <p>• <strong>Regular:</strong> First 8 hours per day, up to 40 per week</p>
                <p>• <strong>Overtime (1.5x):</strong> Hours 8-12 per day, or over 40 per week</p>
                <p>• <strong>Double Time (2x):</strong> Over 12 hours per day</p>
                <p>• <strong>Open shifts:</strong> Still-active shifts are included with hours projected to the current moment (in-memory only; the database is not modified)</p>
              </div>
            </CardContent>
          </Card>

          {/* Flags Statistics — counts the SAME flags the Daily Breakdown
              renders (utils/analyticsFlags.ts pipeline), never the separate
              Metrics-tab mechanics. Zero states render cleanly (0 / 0% / 0.0). */}
          {flagStats && (
            <Card className="border-2 border-slate-200 gap-2">
              <CardHeader className="pt-4 pb-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <Flag className="size-4" />
                  Flags Statistics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Users className="size-3.5 text-slate-500" />
                      <p className="text-xs text-slate-600">Recorded Employees</p>
                    </div>
                    <p className="text-2xl font-bold text-slate-900">{flagStats.recordedEmployees}</p>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <FileText className="size-3.5 text-slate-500" />
                      <p className="text-xs text-slate-600">Total Entries</p>
                    </div>
                    <p className="text-2xl font-bold text-slate-900">{flagStats.totalEntries}</p>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Flag className="size-3.5 text-red-600" />
                      <p className="text-xs text-red-700">Flagged Entries</p>
                    </div>
                    <p className="text-2xl font-bold text-red-700">{flagStats.flaggedEntries}</p>
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Percent className="size-3.5 text-amber-600" />
                      <p className="text-xs text-amber-700">Flagged Rate</p>
                    </div>
                    <p className="text-2xl font-bold text-amber-700">{flagStats.flaggedRate.toFixed(1)}%</p>
                  </div>
                  <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Flag className="size-3.5 text-purple-600" />
                      <p className="text-xs text-purple-700">Total Flags</p>
                    </div>
                    <p className="text-2xl font-bold text-purple-700">{flagStats.totalFlags}</p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Activity className="size-3.5 text-blue-600" />
                      <p className="text-xs text-blue-700">Flags per Flagged Entry</p>
                    </div>
                    <p className="text-2xl font-bold text-blue-700">{flagStats.flagsPerFlaggedEntry.toFixed(1)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Employee Flag Distribution + Flag Frequencies — same SSOT data as
              the stat cards above (computeDayFlags), rendered in the Metrics
              tab's card idiom but computed entirely from the Analytics pipeline. */}
          {flagStats && flagStats.totalEntries > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Employee Flag Distribution */}
              <Card className="border-2 border-slate-200 gap-2">
                <CardHeader className="pt-4 pb-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="size-4" />
                    Employee Flag Distribution
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {flagStats.employeeDist.map((emp) => (
                      <div key={emp.userId} className="flex items-center justify-between p-3 bg-slate-50 rounded border border-slate-200">
                        <div className="flex-1">
                          <p className="font-semibold text-sm text-slate-900">{emp.userName}</p>
                          <p className="text-xs text-slate-500">
                            {emp.flaggedEntries} / {emp.totalEntries} flagged, {emp.totalFlags} total flags
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-slate-900">{emp.flagRate.toFixed(1)}%</span>
                          <Badge
                            variant={emp.riskLevel === 'high' ? 'destructive' : emp.riskLevel === 'medium' ? 'default' : 'secondary'}
                            className={`
                              ${emp.riskLevel === 'high' ? 'bg-red-500' : ''}
                              ${emp.riskLevel === 'medium' ? 'bg-amber-500' : ''}
                              ${emp.riskLevel === 'low' ? 'bg-green-500' : ''}
                            `}
                          >
                            {emp.riskLevel}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Flag Frequencies */}
              <Card className="border-2 border-slate-200 gap-2">
                <CardHeader className="pt-4 pb-0">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Flag className="size-4" />
                    Flag Frequencies
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {flagStats.flagFrequencies.length === 0 && (
                      <p className="text-sm text-slate-500">No flags in this period.</p>
                    )}
                    {flagStats.flagFrequencies.map((item) => (
                      <div key={item.flag} className="flex items-center justify-between p-2 bg-slate-50 rounded border border-slate-200">
                        <span className="text-sm font-medium text-slate-700">{FLAG_LABELS[item.flag] ?? item.flag.replace(/_/g, ' ')}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-slate-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-amber-500"
                              style={{ width: `${flagStats.totalEntries > 0 ? (item.count / flagStats.totalEntries) * 100 : 0}%` }}
                            />
                          </div>
                          <span className="text-sm font-bold text-amber-600 min-w-[3rem] text-right">{item.count}</span>
                        </div>
                      </div>
                    ))}
                    {/* Grand total row */}
                    <div className="flex items-center justify-between p-2 rounded border border-slate-300 bg-slate-100">
                      <span className="text-sm font-semibold text-slate-900">Total</span>
                      <span className="text-sm font-bold text-slate-900 min-w-[3rem] text-right">{flagStats.totalFlags}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
