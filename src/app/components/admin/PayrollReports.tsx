import { useState, useEffect } from 'react';
import { User } from '../../lib/auth';
import { SectionHelp } from '../ui/section-help';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import type { DocumentData } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { fetchGlobalSettings } from '../../../services/systemSettingsService';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '../ui/select';
import { toast } from 'sonner';
import { FileText, Printer, Download, DollarSign, Clock, TrendingUp, ChevronDown, ChevronRight } from 'lucide-react';
import { generateCSV, downloadCSV } from '../../../services/exportService';
import { ALL_USERS, USER_GROUP_OPTIONS, buildUserIdMatcher, isGroupSelection } from '../../../utils/userSelection';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - JS module
import { calculateBiweeklyOvertimeTotals } from '../../../utils/overtimeCalculations.js';
import type { OvertimeEntry } from '../../../utils/overtimeCalculations';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - JS module
import { formatDateShortWithWeekday } from '../../../utils/dateHelpers.js';
import { computeSegmentWorkMinutes } from '../../lib/segmentOps';
import type { TimeSegment } from '../../lib/database';
import { listWorkModels, type WorkModel as WorkModelDef } from '../../../services/workModelsService';
import { filterByExclusionCutoff } from '../../../utils/exclusionFilter';
import { type TimeViewMode, displayTimeForView } from '../../../utils/timeView';

interface PayrollReportsProps {
  allUsers: User[];
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
  regularHours: number;
  overtimeHours: number;
  doubleTimeHours: number;
  totalHours: number;
  dailyEntries?: DocumentData[];
}

export function PayrollReports({ allUsers, timeViewMode = 'local' }: PayrollReportsProps) {
  const [selectedUserId, setSelectedUserId] = useState<string>(ALL_USERS);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [report, setReport] = useState<PayrollSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [payrollSettings, setPayrollSettings] = useState({
    payroll_cycle_type: 'biweekly',
    weekly_start_day: 1,
    biweekly_start_date: '2024-01-01',
    monthly_start_day: 1,
    exclude_records_before_date: '',
  });

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
          });
        }
      } catch (err) {
        console.error('Failed to load payroll settings', err);
      }
    };
    loadSettings();
  }, []);

  const cycleType = payrollSettings.payroll_cycle_type;

  const setQuickPeriod = (preset: 'current' | 'last') => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (cycleType === 'weekly') {
      // Bug fix: was `today.getDay()` (local TZ) — inconsistent for non-UTC users.
      // Now derived from a UTC-anchored YMD so the week boundary is stable.
      const todayYmd = today.toISOString().slice(0, 10);
      const [ty, tm, td] = todayYmd.split('-').map(Number);
      const day = new Date(Date.UTC(ty, tm - 1, td)).getUTCDay();
      const startDay = payrollSettings.weekly_start_day;
      const diff = day >= startDay ? day - startDay : 7 - (startDay - day);

      const currentStart = new Date(Date.UTC(ty, tm - 1, td - diff));
      const currentEnd = new Date(currentStart);
      currentEnd.setUTCDate(currentStart.getUTCDate() + 6);

      if (preset === 'current') {
        setStartDate(currentStart.toISOString().slice(0, 10));
        setEndDate(currentEnd.toISOString().slice(0, 10));
      } else {
        const lastStart = new Date(currentStart);
        lastStart.setUTCDate(lastStart.getUTCDate() - 7);
        const lastEnd = new Date(lastStart);
        lastEnd.setUTCDate(lastStart.getUTCDate() + 6);
        setStartDate(lastStart.toISOString().slice(0, 10));
        setEndDate(lastEnd.toISOString().slice(0, 10));
      }
    } else if (cycleType === 'biweekly' || cycleType === 'custom') {
      // Use anchor date to determine current biweekly block
      let anchorStr = payrollSettings.biweekly_start_date;
      if (!anchorStr) anchorStr = '2024-01-01';
      // UTC-anchored to avoid local-TZ drift
      const [ay, am, ad] = anchorStr.split('-').map(Number);
      const anchor = new Date(Date.UTC(ay, am - 1, ad));

      const todayYmd = today.toISOString().slice(0, 10);
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
        setStartDate(currentStart.toISOString().slice(0, 10));
        setEndDate(currentEnd.toISOString().slice(0, 10));
      } else {
        const lastStart = new Date(currentStart);
        lastStart.setUTCDate(lastStart.getUTCDate() - 14);
        const lastEnd = new Date(lastStart);
        lastEnd.setUTCDate(lastStart.getUTCDate() + 13);
        setStartDate(lastStart.toISOString().slice(0, 10));
        setEndDate(lastEnd.toISOString().slice(0, 10));
      }
    } else if (cycleType === 'monthly') {
      // Configurable monthly cycle anchored on monthly_start_day (1–28).
      // Previously this hardcoded the 1st of the calendar month using
      // browser-local Date (TZ bug). Now UTC-anchored (matching the weekly/
      // biweekly branches) and derived from the configured start day.
      const startDay = Math.min(28, Math.max(1, payrollSettings.monthly_start_day || 1));
      const todayYmd = today.toISOString().slice(0, 10);
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
        setStartDate(currentStart.toISOString().slice(0, 10));
        setEndDate(currentEnd.toISOString().slice(0, 10));
      } else {
        // Last cycle = one month before the current cycle.
        let lastStartY = startY;
        let lastStartM0 = startM0 - 1;
        if (lastStartM0 < 0) { lastStartM0 = 11; lastStartY -= 1; }
        const lastStart = new Date(Date.UTC(lastStartY, lastStartM0, startDay));
        const lastEnd = new Date(currentStart);
        lastEnd.setUTCDate(currentStart.getUTCDate() - 1);
        setStartDate(lastStart.toISOString().slice(0, 10));
        setEndDate(lastEnd.toISOString().slice(0, 10));
      }
    }
  };

  const generateReport = async () => {
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

      // Pull entries from Firestore (same query pattern as the old app).
      // Group selections (All / All Employees / All Managers / All Admins)
      // fetch the full date range, then narrow by role when grouping below.
      // A specific user uses a server-side userId equality filter.
      const base = collection(db, 'timeEntries');
      const q =
        isGroupSelection(selectedUserId)
          ? query(base, where('workDate', '>=', startDate), where('workDate', '<=', endDate), orderBy('workDate', 'asc'))
          : query(
            base,
            where('userId', '==', selectedUserId),
            where('workDate', '>=', startDate),
            where('workDate', '<=', endDate),
            orderBy('workDate', 'asc')
          );

      const snap = await getDocs(q);
      const rawEntries = filterByExclusionCutoff(
        snap.docs.map(d => d.data()).filter(e => e.dayComplete === true),
        payrollSettings.exclude_records_before_date,
        (e: DocumentData) => String(e.workDate || e.date || ''),
      ).map(e => {
          // Rebuild the day's total from the canonical segments[] sum.
          // Split-shift (multi-segment) docs persist only the final shift's
          // minutes in the root totalWorkMinutes field (e.g. 353 for shift 2,
          // not 1090+353=1443 for the full day). Feeding the stale root value
          // into calculateWeeklyOvertimeAdjustments understated daily OT/DT.
          //
          // Per-segment workMinutes is also recomputed from the system
          // timestamp delta (clockInSystem/clockOutSystem) so multi-day spans
          // — whose stored workMinutes were capped by the old single-day
          // heuristic — feed accurate durations into the day total and the
          // overtime engine. Manual-only segments keep their stored value via
          // the computeSegmentWorkMinutes fallback.
          const segs = Array.isArray(e.segments) ? e.segments : [];
          if (segs.length === 0) return e;
          const rebuiltSegs = segs.map((s: DocumentData) => ({
            ...s,
            workMinutes: computeSegmentWorkMinutes(s as TimeSegment),
          }));
          const segTotal = rebuiltSegs.reduce((sum, s) => sum + (Number(s.workMinutes) || 0), 0);
          if (segs.length > 1) {
            return {
              ...e,
              segments: rebuiltSegs,
              totalWorkMinutes: segTotal,
              totalHours: segTotal / 60,
              regularMinutes: undefined,
              otMinutes: undefined,
              doubleTimeMinutes: undefined,
            };
          }
          // Single-segment docs keep root fields in sync with segments[0]
          // (S7 invariant); rebuild defensively but trust any stored buckets.
          return { ...e, segments: rebuiltSegs, totalWorkMinutes: segTotal, totalHours: segTotal / 60 };
        });

      // Group by employee and calculate biweekly overtime totals (California rules)
      const byUser = new Map<string, OvertimeEntry[]>();
      rawEntries.forEach(e => {
        const uid = String(e.userId || '');
        if (!byUser.has(uid)) byUser.set(uid, []);
        byUser.get(uid)!.push(e as OvertimeEntry);
      });

      const summaries: PayrollSummary[] = [];
      // For role-group selections, drop grouped users whose role doesn't match.
      // (A specific user is already server-filtered; "All" keeps everyone.)
      const roleMatcher = buildUserIdMatcher(selectedUserId, allUsers);
      for (const [userId, entries] of byUser.entries()) {
        if (!roleMatcher(userId)) continue;
        const userObj = allUsers.find(u => u.uid === userId);
        const userWorkModel = userObj?.workModelId ? workModelById.get(userObj.workModelId) ?? null : null;
        const userOverride = userObj?.workModelOverride ?? null;
        const ot = calculateBiweeklyOvertimeTotals(entries, payrollSettings.weekly_start_day, userWorkModel, userOverride);
        summaries.push({
          userId,
          userName: allUsers.find(u => u.uid === userId)?.name || 'Unknown',
          workModel: userWorkModel?.name || userObj?.workModel || 'On-site',
          regularHours: (ot.grandTotals.regularMinutes || 0) / 60,
          overtimeHours: (ot.grandTotals.otMinutes || 0) / 60,
          doubleTimeHours: (ot.grandTotals.doubleTimeMinutes || 0) / 60,
          totalHours: (ot.grandTotals.totalMinutes || 0) / 60,
          dailyEntries: ot.adjustedEntries.sort((a, b) => b.workDate.localeCompare(a.workDate))
        });
      }

      summaries.sort((a, b) => a.userName.localeCompare(b.userName));
      setReport(summaries);
      toast.success('Report generated');
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (!report) return;

    const headers = ['Employee', 'Regular Hours', 'Overtime (1.5x)', 'Double Time (2x)', 'Total Hours'];
    const rows = report.map(r => [
      r.userName,
      r.regularHours.toFixed(2),
      r.overtimeHours.toFixed(2),
      r.doubleTimeHours.toFixed(2),
      r.totalHours.toFixed(2),
    ]);

    const csvContent = generateCSV(headers, rows);
    downloadCSV(`payroll-report-${startDate}-to-${endDate}`, csvContent);
    toast.success('CSV exported');
  };

  const printReport = () => {
    window.print();
  };

  const totalRegular = report?.reduce((acc, r) => acc + r.regularHours, 0) || 0;
  const totalOvertime = report?.reduce((acc, r) => acc + r.overtimeHours, 0) || 0;
  const totalDouble = report?.reduce((acc, r) => acc + r.doubleTimeHours, 0) || 0;
  const grandTotal = report?.reduce((acc, r) => acc + r.totalHours, 0) || 0;

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

  // PT (America/Los_Angeles) YYYY-MM-DD for an epoch-ms instant. Per AGENTS.md
  // the canonical timezone for all payroll date math is PT.
  const ptDateStr = (ms: number): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(ms));

  // Calendar-day difference (PT) between two epoch-ms instants. Used to label
  // how many days a clock-out/lunch falls after the shift's clock-in.
  const dayOffsetFromSystem = (anchorMs: number, targetMs: number): number => {
    const a = ptDateStr(anchorMs);
    const b = ptDateStr(targetMs);
    const [ay, am, ad] = a.split('-').map(Number);
    const [by, bm, bd] = b.split('-').map(Number);
    if (!ay || !by) return 0;
    const dayA = Date.UTC(ay, am - 1, ad);
    const dayB = Date.UTC(by, bm - 1, bd);
    return Math.round((dayB - dayA) / (1000 * 60 * 60 * 24));
  };

  const getDayBoundaries = (day: DocumentData): { clockIn?: TimeBoundary; clockOut?: TimeBoundary } => {
    const segs = day.segments;
    if (!Array.isArray(segs) || segs.length === 0) {
      // Legacy single-shift doc.
      const inMs = typeof day.clockInSystem === 'number' ? day.clockInSystem : undefined;
      const outMs = typeof day.clockOutSystem === 'number' ? day.clockOutSystem : undefined;
      let outOffset = 0;
      if (inMs !== undefined && outMs !== undefined) {
        outOffset = dayOffsetFromSystem(inMs, outMs);
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
    // Earliest clock-in and latest clock-out across all segments, using system
    // timestamps for true chronology (falls back to manual minutes).
    let earliest: { time: string; ms?: number; abs: number } | null = null;
    let latest: { time: string; ms?: number; abs: number; manualWrapped: boolean } | null = null;
    for (const s of segs) {
      const inMs = typeof s.clockInSystem === 'number' ? s.clockInSystem : undefined;
      const inM = toMinutes(s.clockInManual);
      const inAbs = inMs ?? (Number.isNaN(inM) ? NaN : inM);
      if (!Number.isNaN(inAbs) && (!earliest || inAbs < earliest.abs)) {
        earliest = { time: s.clockInManual, ms: inMs, abs: inAbs };
      }
      const outMs = typeof s.clockOutSystem === 'number' ? s.clockOutSystem : undefined;
      const outM = toMinutes(s.clockOutManual);
      let outAbs: number;
      const wrapped = !Number.isNaN(inM) && !Number.isNaN(outM) && outM < inM;
      if (outMs !== undefined) {
        outAbs = outMs;
      } else if (!Number.isNaN(inM) && !Number.isNaN(outM)) {
        outAbs = wrapped ? outM + 1440 : outM;
      } else {
        outAbs = NaN;
      }
      if (!Number.isNaN(outAbs) && (!latest || outAbs > latest.abs)) {
        latest = { time: s.clockOutManual, ms: outMs, abs: outAbs, manualWrapped: wrapped };
      }
    }
    // Day offset for the latest clock-out, relative to the earliest clock-in.
    let outOffset = 0;
    if (earliest?.ms !== undefined && latest?.ms !== undefined) {
      outOffset = dayOffsetFromSystem(earliest.ms, latest.ms);
    } else if (earliest && latest && earliest.ms === undefined && latest.ms === undefined) {
      // All-manual: infer from absolute-minute gap.
      const gap = latest.abs - earliest.abs;
      outOffset = gap >= 1440 ? Math.floor(gap / 1440) : (latest.manualWrapped ? 1 : 0);
    } else if (latest) {
      // Mixed system/manual: fall back to the latest segment's own wrap.
      outOffset = latest.manualWrapped ? 1 : 0;
    }
    return {
      clockIn: earliest ? { time: earliest.time, ms: earliest.ms, dayOffset: 0 } : undefined,
      clockOut: latest ? { time: latest.time, ms: latest.ms, dayOffset: outOffset } : undefined,
    };
  };

  // 3-way lunch summary: 0 breaks → none; 1 break → its times; 2+ → multiple.
  // dayOffset for a break is relative to the owning segment's clock-in.
  const getDayLunch = (day: DocumentData): { lunchOut?: TimeBoundary; lunchIn?: TimeBoundary; isMultiple: boolean } => {
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
      const loOffset = inMs !== undefined && loMs !== undefined ? dayOffsetFromSystem(inMs, loMs)
        : (!Number.isNaN(inM) && !Number.isNaN(loM) && loM < inM ? 1 : 0);
      const liOffset = inMs !== undefined && liMs !== undefined ? dayOffsetFromSystem(inMs, liMs)
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
      const loOffset = inMs !== undefined && loMs !== undefined ? dayOffsetFromSystem(inMs, loMs)
        : (!Number.isNaN(inM) && !Number.isNaN(loM) && loM < inM ? 1 : 0);
      const liOffset = inMs !== undefined && liMs !== undefined ? dayOffsetFromSystem(inMs, liMs)
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
  ): number => {
    const inMs = typeof seg.clockInSystem === 'number' ? seg.clockInSystem : undefined;
    const sysField = field === 'clockOutManual' ? 'clockOutSystem'
      : field === 'lunchOutManual' ? 'lunchOutSystem'
      : 'lunchInSystem';
    const tMs = typeof seg[sysField] === 'number' ? seg[sysField] : undefined;
    if (inMs !== undefined && tMs !== undefined) {
      return Math.max(0, dayOffsetFromSystem(inMs, tMs));
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

  return (
    <div className="space-y-4">
      {/* Report Setup Card */}
      <Card className="border-2 border-slate-200 gap-3">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-xl font-bold flex items-center gap-2">
            <FileText className="size-5" />
            Payroll Report Setup
          </CardTitle>
          <SectionHelp
            title="Payroll Reports"
            description="Generates summary reports regarding accumulated aggregates across cycle nodes."
            sections={[
              { title: "Setup View", content: "Filter by User and Period thresholds to accumulate total intervals." },
              { title: "Details Breakdowns", content: "Click 'View Details' on card objects to expand precise timestamp rows grids." },
              { title: "Cycle Configuration", content: "Admin adjusts defaults cycle types in global System Settings." }
            ]}
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
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
              <Button onClick={generateReport} disabled={loading} className="w-full h-10 bg-blue-600 hover:bg-blue-700">
                <FileText className="size-4 mr-2" />
                {loading ? 'Generating...' : 'Generate Report'}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Button variant="outline" size="sm" onClick={() => setQuickPeriod('current')} className="h-8 text-xs">
              Current Cycle
            </Button>
            <Button variant="outline" size="sm" onClick={() => setQuickPeriod('last')} className="h-8 text-xs">
              Last Cycle
            </Button>
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
                      <p className="text-2xl font-bold text-slate-900">{totalRegular.toFixed(1)}</p>
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
                      <p className="text-2xl font-bold text-slate-900">{totalOvertime.toFixed(1)}</p>
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
                      <p className="text-2xl font-bold text-slate-900">{totalDouble.toFixed(1)}</p>
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
                      <p className="text-2xl font-bold text-slate-900">{grandTotal.toFixed(1)}</p>
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

          {/* Employee Cards - Mobile Friendly */}
          <div className="space-y-2">
            {report.map(summary => {
              // Employee's local timezone for the Req-4 'local' view mode.
              const empTz = allUsers.find(u => u.uid === summary.userId)?.timezone;
              return (
              <Card key={summary.userId} className="border-2 border-slate-200">
                <CardContent className="py-1 px-2 [&:last-child]:pb-1">
                  <div className="flex flex-row items-center justify-between gap-4 py-1 px-2">
                    {/* Left — employee info */}
                    <div className="flex flex-col shrink-0 min-w-[150px]">
                      <h3 className="text-sm font-bold text-slate-900">{summary.userName}</h3>
                      <p className="text-xs text-slate-400">Total: {summary.totalHours.toFixed(2)} hours</p>
                    </div>

                    {/* Center — metric boxes */}
                    <div className="flex-1 grid grid-cols-3 gap-3 items-center">
                      <div className="bg-slate-50 py-1.5 px-3 rounded-lg border border-slate-200">
                        <p className="text-xs text-slate-600 mb-0.5">Regular</p>
                        <p className="text-lg font-bold text-slate-900">{summary.regularHours.toFixed(1)}</p>
                      </div>
                      <div className="bg-orange-50 py-1.5 px-3 rounded-lg border border-orange-200">
                        <p className="text-xs text-orange-700 mb-0.5">OT 1.5x</p>
                        <p className="text-lg font-bold text-orange-700">{summary.overtimeHours.toFixed(1)}</p>
                      </div>
                      <div className="bg-red-50 py-1.5 px-3 rounded-lg border border-red-200">
                        <p className="text-xs text-red-700 mb-0.5">DT 2x</p>
                        <p className="text-lg font-bold text-red-700">{summary.doubleTimeHours.toFixed(1)}</p>
                      </div>
                    </div>

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
                    <div className="mt-2 pt-2 border-t border-slate-200 overflow-x-auto px-2">
                      <p className="text-xs font-semibold text-slate-700 mb-2">Daily Breakdown</p>
                      <table className="w-full text-xs text-left text-slate-600">
                        <thead className="bg-slate-50 text-slate-700 font-semibold">
                          <tr>
                            <th className="p-1.5">Date</th>
                            <th className="p-1.5">In</th>
                            <th className="p-1.5">L.Out</th>
                            <th className="p-1.5">L.In</th>
                            <th className="p-1.5">Out</th>
                            <th className="p-1.5 text-right">Reg</th>
                            <th className="p-1.5 text-right">OT</th>
                            <th className="p-1.5 text-right">DT</th>
                            <th className="p-1.5 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.dailyEntries.flatMap((day: DocumentData) => {
                            const b = getDayBoundaries(day);
                            const lunch = getDayLunch(day);
                            const segs = Array.isArray(day.segments) ? day.segments : [];
                            const isMultiShift = segs.length > 1;
                            const dateKey = `${summary.userId}|${day.workDate}`;
                            const isDateExpanded = expandedDates.has(dateKey);
                            const toggleDate = () => {
                              setExpandedDates(prev => {
                                const next = new Set(prev);
                                if (next.has(dateKey)) next.delete(dateKey);
                                else next.add(dateKey);
                                return next;
                              });
                            };
                            const dayTotalHours = (day.totalWorkMinutes || 0) / 60;

                            // Missing-lunch flag for the daily aggregate row.
                            // Applies ONLY to On-site employees. Lunch is
                            // "missing" when no break was recorded anywhere in
                            // the day — i.e. getDayLunch returned no lunchOut/
                            // lunchIn and isMultiple is false (0 breaks total
                            // across all shifts). If any shift took a lunch,
                            // getDayLunch returns either the single break's
                            // times or isMultiple:true, so the row is not
                            // flagged. Sub-shift rows are intentionally exempt.
                            const isOnsite = summary.workModel === 'On-site';
                            const lunchMissing = isOnsite && !lunch.isMultiple && !lunch.lunchOut && !lunch.lunchIn;

                            const renderLunchCell = (boundary: TimeBoundary | undefined): JSX.Element => {
                              if (lunch.isMultiple) return <span className="italic text-slate-400">Multiple</span>;
                              if (lunchMissing) return <span className="inline-block bg-red-100 text-red-700 font-semibold border border-red-200 px-2 py-0.5 rounded">--</span>;
                              return fmtBoundary(boundary, empTz);
                            };

                            const rows: JSX.Element[] = [
                              <tr key={day.workDate} className="border-b border-slate-100 hover:bg-slate-50/50">
                                <td className="p-1.5 font-medium">
                                  <span className={`inline-flex items-center gap-1 ${isMultiShift ? 'cursor-pointer' : ''}`} onClick={isMultiShift ? toggleDate : undefined}>
                                    {isMultiShift && (
                                      isDateExpanded
                                        ? <ChevronDown className="size-3.5 text-slate-500" />
                                        : <ChevronRight className="size-3.5 text-slate-500" />
                                    )}
                                    {formatDateShortWithWeekday(day.workDate)}
                                    {isMultiShift && (
                                      <span className="ml-1 text-xs font-normal text-slate-400">({segs.length} shifts)</span>
                                    )}
                                  </span>
                                </td>
                                <td className="p-1.5">{fmtBoundary(b.clockIn, empTz)}</td>
                                <td className="p-1.5">
                                  {renderLunchCell(lunch.lunchOut)}
                                </td>
                                <td className="p-1.5">
                                  {renderLunchCell(lunch.lunchIn)}
                                </td>
                                <td className="p-1.5">{fmtBoundary(b.clockOut, empTz)}</td>
                                <td className="p-1.5 text-right">{((day.regularMinutes || 0) / 60).toFixed(1)}</td>
                                <td className="p-1.5 text-right">{((day.otMinutes || 0) / 60).toFixed(1)}</td>
                                <td className="p-1.5 text-right">{((day.doubleTimeMinutes || 0) / 60).toFixed(1)}</td>
                                <td className={`p-1.5 text-right font-semibold ${dayTotalHours > 8 ? 'text-red-600' : ''}`}>
                                  {dayTotalHours.toFixed(1)}
                                </td>
                              </tr>
                            ];

                            if (isMultiShift && isDateExpanded) {
                              segs.forEach((seg: DocumentData, i: number) => {
                                const shiftTotalHours = (seg.workMinutes || 0) / 60;
                                rows.push(
                                  <tr key={`${day.workDate}-seg-${i}`} className="bg-purple-50/40 hover:bg-purple-50/70 border-b border-purple-100">
                                    <td className="p-1.5 pl-6 text-purple-700 font-medium">↳ Shift {i + 1}</td>
                                    <td className="p-1.5">{fmtBoundary({ time: seg.clockInManual, ms: seg.clockInSystem, dayOffset: 0 }, empTz)}</td>
                                    <td className="p-1.5">
                                      {seg.skipLunch ? <span className="italic text-slate-400">skipped</span> : fmtBoundary({ time: seg.lunchOutManual, ms: seg.lunchOutSystem, dayOffset: segFieldDayOffset(seg, 'lunchOutManual') }, empTz)}
                                    </td>
                                    <td className="p-1.5">
                                      {seg.skipLunch ? <span className="italic text-slate-400">skipped</span> : fmtBoundary({ time: seg.lunchInManual, ms: seg.lunchInSystem, dayOffset: segFieldDayOffset(seg, 'lunchInManual') }, empTz)}
                                    </td>
                                    <td className="p-1.5">{fmtBoundary({ time: seg.clockOutManual, ms: seg.clockOutSystem, dayOffset: segFieldDayOffset(seg, 'clockOutManual') }, empTz)}</td>
                                    <td className="p-1.5 text-right text-slate-400">--</td>
                                    <td className="p-1.5 text-right text-slate-400">--</td>
                                    <td className="p-1.5 text-right text-slate-400">--</td>
                                    <td className={`p-1.5 text-right font-semibold ${shiftTotalHours > 8 ? 'text-red-600' : 'text-purple-700'}`}>
                                      {shiftTotalHours.toFixed(1)}
                                    </td>
                                  </tr>
                                );
                              });
                            }

                            return rows;
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
              );
            })}
          </div>

          {/* Info Card */}
          <Card className="border-2 border-blue-200 bg-blue-50">
            <CardContent className="p-4">
              <p className="text-sm font-semibold text-blue-900 mb-2">California Overtime Rules Applied</p>
              <div className="text-sm text-blue-800 space-y-1">
                <p>• <strong>Regular:</strong> First 8 hours per day, up to 40 per week</p>
                <p>• <strong>Overtime (1.5x):</strong> Hours 8-12 per day, or over 40 per week</p>
                <p>• <strong>Double Time (2x):</strong> Over 12 hours per day</p>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
