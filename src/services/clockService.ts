import {
  doc,
  getDoc,
  runTransaction,
  Timestamp,
  updateDoc,
  setDoc,
} from 'firebase/firestore';
import { db } from '../app/lib/firebase';
import type { TimeEntry, TimeSegment } from '../app/lib/database';
import {
  dbService,
  getActiveSegment,
  hasOpenSegment,
  createInitialSegment,
  closeActiveSegment,
  applyLunchToSegment,
  stripUndefined,
} from '../app/lib/database';
import {
  getCurrentPTDate,
  getCurrentPTTimeHHMM,
  getPTWeekStart,
  getPTDate,
} from '../utils/timeCalculations';
import {
  validateCanPunchIn,
  validateCanPunchOut,
  validateCanToggleLunch,
} from '../utils/timeValidation';

/**
 * ClockService — owned by Clock Agent (Phase 1)
 *
 * Thin, atomic wrapper around the TimeSegment model for employee punch flows.
 * - Enforces "exactly one open segment per employee per PT workDate"
 * - Uses Firestore transaction on punchIn for double-tap safety across tabs/devices
 * - Always writes in America/Los_Angeles for workDate + manual times
 * - Dual-writes legacy flat fields + segments[] for full backward compat
 *   with HistoryView, PayrollReports, TeamDashboard, etc.
 *
 * Never hard-deletes. Status remains "active" (future Admin can correct/void).
 */

export interface PunchStatus {
  entry: TimeEntry | null;
  activeSegment: TimeSegment | null;
  isClockedIn: boolean;
  isOnLunch: boolean;
  todayTotalMinutes: number;
  currentPTTime: string;
  currentPTDate: string;
}

export interface WeekSummary {
  totalMinutes: number;
  daysWorked: number;
  entries: TimeEntry[];
  weekStart: string;
  weekEnd: string;
}

/** Get or hydrate today's time entry for the user (PT date). */
export async function getTodayEntry(userId: string): Promise<TimeEntry | null> {
  const ptDate = getCurrentPTDate();
  return dbService.getTimeEntry(userId, ptDate);
}

/**
 * Subtract N days from a PT YYYY-MM-DD date string, returning the PT
 * YYYY-MM-DD. Uses a PT-noon UTC anchor (matches the getPTWeekStart pattern)
 * to avoid DST/midnight-boundary off-by-one errors.
 */
function subtractPTDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d - days, 12, 0, 0));
  return getPTDate(anchor);
}

/**
 * S5: Locate the user's open shift across recent PT days.
 *
 * The "one open segment per employee" invariant can span PT days: an employee
 * who clocks in at 23:00 PT and clocks out at 02:00 PT has an open segment on
 * the PRIOR day's doc after midnight PT. Today's doc won't contain it, so
 * punchOut/getPunchStatus/toggleLunch must look beyond today to find the open
 * shift, close it, and keep the status card accurate across midnight.
 *
 * Fast path: today's doc (single getDoc). Fallback: last 3 PT days via a
 * range query (covers weekends + safety margin). Returns the most-recent
 * entry whose `getActiveSegment` is non-null, or null. Voided/archived docs
 * are skipped (getActiveSegment short-circuits them).
 *
 * Pure read; write callers re-read the target doc inside their transaction /
 * before updateDoc for consistency. Canonical workDate stays on the punch-in
 * PT day (correct payroll attribution per AGENTS.md §2).
 */
export async function findOpenShiftEntry(userId: string): Promise<TimeEntry | null> {
  const today = getCurrentPTDate();
  // Fast path: today's doc.
  const todayEntry = await dbService.getTimeEntry(userId, today);
  if (todayEntry && getActiveSegment(todayEntry)) return todayEntry;
  // Fallback: scan recent days for a cross-midnight open shift.
  const start = subtractPTDays(today, 3);
  const entries = await dbService.getTimeEntriesForUserInRange(userId, start, today);
  for (const e of entries) {
    if (todayEntry && e.id === todayEntry.id) continue; // already checked, no open segment
    if (getActiveSegment(e)) return e;
  }
  return null;
}

/** Core punch-in. Atomic. Rejects if open segment already exists. */
export async function punchIn(userId: string, taskId?: string): Promise<TimeEntry> {
  const ptDate = getCurrentPTDate();
  const ptTime = getCurrentPTTimeHHMM();
  const now = Timestamp.now();
  const entryId = `${userId}_${ptDate}`;

  // S5: reject if there's already an open shift on ANY recent PT day, not
  // just today. Without this, a cross-midnight open shift on yesterday's doc
  // would be orphaned and a second open shift would start today, violating
  // the one-open-segment invariant. The transaction's own validateCanPunchIn
  // remains as a concurrency backstop for today's doc.
  const existingOpen = await findOpenShiftEntry(userId);
  if (existingOpen) {
    throw new Error(
      `You already have an open shift (started ${existingOpen.date}). Clock out before starting a new one.`
    );
  }

  const result = await runTransaction(db, async (tx) => {
    const ref = doc(db, 'timeEntries', entryId);
    const snap = await tx.get(ref);

    let existing: TimeEntry | null = null;
    if (snap.exists()) {
      existing = /* map via simple shape */ {
        id: snap.id,
        userId,
        date: ptDate,
        // Include status so the voided/archived check in hasOpenSegmentLocal
        // can short-circuit. Without this, soft-voided test docs are still
        // treated as an open shift by validateCanPunchIn.
        status: snap.data().status,
        segments: Array.isArray(snap.data().segments) ? snap.data().segments : undefined,
        // minimal for hasOpen check
      } as any;
    }

    const v = validateCanPunchIn(existing as any);
    if (!v.valid) {
      throw new Error(v.message || 'Cannot punch in');
    }

    const newSeg = createInitialSegment(ptTime, now.toMillis(), taskId);

    // Preserve any previously closed segments from this document so a split-shift
    // punch-in (after a previous punch-out) does not wipe out the archived work.
    // tx.set with merge:true REPLACES array fields rather than merging them, so
    // we explicitly build the full array here.
    const existingSegments = snap.exists() ? (snap.data().segments || []) : [];
    const existingCreatedAt = snap.exists() ? snap.data().createdAt : undefined;

    // When re-using a doc after a previous punch-out (split shift), clear the
    // legacy top-level clock-out fields so the new shift starts clean.
    const closedSegmentsTotal = (existingSegments as TimeSegment[])
      .filter((s) => s.complete)
      .reduce((sum, s) => sum + (s.workMinutes || 0), 0);

    const payload: any = {
      userId,
      workDate: ptDate,
      clockInManual: ptTime,
      clockInSystemTime: now,
      clockInSystem: now.toMillis(),
      currentStep: 2,
      dayComplete: false,
      complete: false,
      segments: [...existingSegments, stripUndefined(newSeg as any)],
      totalWorkMinutes: closedSegmentsTotal,
      createdBy: userId,
      updatedAt: now,
      updatedBy: userId,
      status: 'active',
      timezoneAtCreation: 'America/Los_Angeles',
      // Clear stale legacy fields from any previous closed shift on this doc
      clockOutManual: null,
      clockOutSystem: null,
      clockOutSystemTime: null,
      completedAt: null,
      lunchOutManual: null,
      lunchInManual: null,
      lunchSkipped: false,
      skipLunch: false,
    };
    if (existingCreatedAt !== undefined) payload.createdAt = existingCreatedAt;
    else payload.createdAt = now;

    tx.set(ref, payload, { merge: true });
    return { entryId, newSeg, ptDate, ptTime, wasCreated: !snap.exists() };
  });

  // Return hydrated view (mapEntry will reconstruct)
  const fresh = await dbService.getTimeEntry(userId, ptDate);
  if (!fresh) throw new Error('Punch in succeeded but read failed');
  return fresh;
}

/** Clock out the open segment. */
export async function punchOut(userId: string): Promise<TimeEntry> {
  const ptTime = getCurrentPTTimeHHMM();
  const now = Timestamp.now();

  // S5: locate the open shift across recent PT days. A cross-midnight shift
  // (e.g. 23:00 -> 02:00 PT) has its open segment on the PRIOR day's doc;
  // computing entryId from today's PT date would miss it and punch-out would
  // fail with "No open shift". We write the clock-out fields back to that
  // same doc, keeping its workDate as the punch-in PT day (canonical payroll
  // attribution, AGENTS.md §2). The ptTime (today's PT wall clock) is stored
  // as clockOutManual; closeActiveSegment's S6 wrap computes the correct
  // cross-midnight duration.
  const openEntry = await findOpenShiftEntry(userId);
  if (!openEntry) {
    throw new Error('No open shift to clock out of. Clock in first.');
  }
  const entryId = openEntry.id;
  const workDate = openEntry.date;

  const result = await runTransaction(db, async (tx) => {
    const ref = doc(db, 'timeEntries', entryId);
    const snap = await tx.get(ref);

    let existing: TimeEntry | null = null;
    if (snap.exists()) {
      existing = {
        id: snap.id,
        userId,
        date: snap.data().workDate || workDate,
        status: snap.data().status,
        segments: Array.isArray(snap.data().segments) ? snap.data().segments : undefined,
        clockInManual: snap.data().clockInManual || undefined,
        clockOutManual: snap.data().clockOutManual || undefined,
        complete: snap.data().complete || snap.data().dayComplete || false,
      } as any;
    }

    const v = validateCanPunchOut(existing as any);
    if (!v.valid) throw new Error(v.message);

    const active = getActiveSegment(existing as any);
    if (!active) throw new Error('No active segment');

    const closedSeg = closeActiveSegment(active, ptTime, now.toMillis());

    const archived = (existing?.segments || []).filter((s: TimeSegment) => s.id !== active.id);
    const finalSegments = [...archived, closedSeg].map((s) => stripUndefined(s as any));

    const preTotal = (existing?.totalWorkMinutes as number) || 0;
    const newTotal = preTotal + (closedSeg.workMinutes || 0);

    tx.update(ref, {
      clockOutManual: ptTime,
      clockOutSystemTime: now,
      clockOutSystem: now.toMillis(),
      complete: true,
      currentStep: 4,
      dayComplete: true,
      completedAt: now.toMillis(),
      segments: finalSegments,
      totalWorkMinutes: newTotal,
      updatedAt: now,
      updatedBy: userId,
    } as any);

    return { entryId, closedSeg, finalSegments, newTotal };
  });

  // Re-read the SAME doc (workDate = punch-in PT day, which may be yesterday)
  // to return the hydrated view. dbService.getTimeEntry rebuilds entryId from
  // userId + workDate, which matches `entryId` above.
  const fresh = await dbService.getTimeEntry(userId, workDate);
  if (!fresh) throw new Error('Punch out succeeded but read failed');
  return fresh;
}

/** Toggle lunch on the current open segment (start or end). */
export async function toggleLunch(userId: string, skip = false): Promise<TimeEntry> {
  const ptTime = getCurrentPTTimeHHMM();
  const now = Timestamp.now();

  // S5: locate the open shift across recent PT days (cross-midnight support).
  // The open segment may live on a prior day's doc after midnight PT.
  const pre = await findOpenShiftEntry(userId);
  if (!pre) {
    throw new Error('No active segment for lunch');
  }
  const entryId = pre.id;
  const workDate = pre.date;

  const v = validateCanToggleLunch(pre);
  if (!v.valid) throw new Error(v.message);

  const active = getActiveSegment(pre);
  if (!active) throw new Error('No active segment for lunch');

  let action: 'start' | 'end' | 'skip' = 'start';
  if (skip) action = 'skip';
  else if (active.lunchOutManual || active.lunchOutSystem) action = 'end';

  const updatedSeg = applyLunchToSegment(active, action, ptTime, now.toMillis());

  // Dual update legacy lunch fields + the segment in place
  const patch: any = {
    updatedAt: now,
    updatedBy: userId,
  };

  if (action === 'start' || action === 'skip') {
    patch.lunchOutManual = skip ? '' : ptTime;
    patch.lunchOutSystemTime = skip ? null : now;
    patch.lunchSkipped = skip;
    patch.skipLunch = skip;
  }
  if (action === 'end') {
    patch.lunchInManual = ptTime;
    patch.lunchInSystemTime = now;
  }

  // Rebuild segments array with the updated one
  const newSegments = (pre?.segments || []).map((s) =>
    s.id === active.id ? stripUndefined(updatedSeg as any) : stripUndefined(s as any)
  );
  patch.segments = newSegments;

  await updateDoc(doc(db, 'timeEntries', entryId), patch);

  // Re-read the SAME doc (workDate may be a prior PT day after midnight).
  const fresh = await dbService.getTimeEntry(userId, workDate);
  if (!fresh) throw new Error('Lunch toggle succeeded but read failed');
  return fresh;
}

/** Rich status for the punch UI (today only). */
export async function getPunchStatus(userId: string): Promise<PunchStatus> {
  const ptDate = getCurrentPTDate();
  const ptTime = getCurrentPTTimeHHMM();
  // S5: locate the open shift across recent PT days. After midnight PT, the
  // open segment lives on a prior day's doc; without this the status card
  // would flip to "CLOCK IN" while the employee is still on shift.
  const entry = await findOpenShiftEntry(userId);
  const active = getActiveSegment(entry);

  const isOnLunch =
    !!active &&
    (active.lunchOutManual || active.lunchOutSystem) &&
    !(active.lunchInManual || active.lunchInSystem) &&
    !active.skipLunch;

  let todayTotal = 0;
  if (entry?.segments?.length) {
    todayTotal = entry.segments.reduce((sum, s) => sum + (s.workMinutes || 0), 0);
    if (active && !active.complete) {
      const inM = timeStringToMinutes(active.clockInManual || ptTime);
      const nowM = timeStringToMinutes(ptTime);
      // S6: cross-midnight wrap for live elapsed. If "now" is earlier than
      // clock-in, the shift crossed midnight (e.g. in=23:00, now=02:00).
      const effNowM = nowM < inM ? nowM + 24 * 60 : nowM;
      if (isOnLunch && active.lunchOutManual) {
        const lunchOutM = timeStringToMinutes(active.lunchOutManual);
        const effLunchOutM = lunchOutM < inM ? lunchOutM + 24 * 60 : lunchOutM;
        todayTotal += Math.max(0, effLunchOutM - inM);
      } else {
        todayTotal += Math.max(0, effNowM - inM);
      }
    }
  }

  return {
    entry,
    activeSegment: active,
    isClockedIn: !!active,
    isOnLunch,
    todayTotalMinutes: Math.floor(todayTotal),
    currentPTTime: ptTime,
    currentPTDate: ptDate,
  };
}

/** This week's summary (PT week, Monday start). */
export async function getWeekSummary(userId: string): Promise<WeekSummary> {
  const ptDate = getCurrentPTDate();
  const weekStart = getPTWeekStart(ptDate);
  // Simple 7-day window (inclusive)
  const weekEnd = getCurrentPTDate(); // today

  const entries = await dbService.getTimeEntriesForUserInRange(userId, weekStart, weekEnd);

  let total = 0;
  let daysWorked = 0;
  for (const e of entries) {
    // `entry.totalWorkMinutes` is the canonical day total maintained by
    // `mapEntry` (it includes archived + current-segment minutes, and falls
    // back to the stored legacy value when there are no segments). Legacy
    // TodayEntry docs have `totalWorkMinutes` set but `segments[]` empty, so
    // summing only `seg.workMinutes` silently dropped their entire day from
    // the week total. Prefer the day-total field; fall back to summing the
    // persisted segments when it is absent.
    const mins =
      typeof e.totalWorkMinutes === 'number'
        ? e.totalWorkMinutes
        : (e.segments?.reduce((s, seg) => s + (seg.workMinutes || 0), 0) || 0);
    total += mins;
    if (mins > 0) daysWorked++;
  }

  return {
    totalMinutes: total,
    daysWorked,
    entries,
    weekStart,
    weekEnd: ptDate,
  };
}

// Local helper (dupe of internal to avoid import)
function timeStringToMinutes(t?: string): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
