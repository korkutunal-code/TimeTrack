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
} from '../app/lib/database';
import {
  getCurrentPTDate,
  getCurrentPTTimeHHMM,
  getPTWeekStart,
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

/** Core punch-in. Atomic. Rejects if open segment already exists. */
export async function punchIn(userId: string, taskId?: string): Promise<TimeEntry> {
  const ptDate = getCurrentPTDate();
  const ptTime = getCurrentPTTimeHHMM();
  const now = Timestamp.now();
  const entryId = `${userId}_${ptDate}`;

  const result = await runTransaction(db, async (tx) => {
    const ref = doc(db, 'timeEntries', entryId);
    const snap = await tx.get(ref);

    let existing: TimeEntry | null = null;
    if (snap.exists()) {
      existing = /* map via simple shape */ {
        id: snap.id,
        userId,
        date: ptDate,
        segments: Array.isArray(snap.data().segments) ? snap.data().segments : undefined,
        // minimal for hasOpen check
      } as any;
    }

    const v = validateCanPunchIn(existing as any);
    if (!v.valid) {
      throw new Error(v.message || 'Cannot punch in');
    }

    const newSeg = createInitialSegment(ptTime, now.toMillis(), taskId);

    // Dual-write: legacy current fields + segments array (first segment)
    const payload: any = {
      userId,
      workDate: ptDate,
      clockInManual: ptTime,
      clockInSystemTime: now,
      clockInSystem: now.toMillis(),
      currentStep: 2,
      dayComplete: false,
      complete: false,
      segments: [newSeg],
      createdAt: snap.exists() ? snap.data().createdAt : now,
      createdBy: userId,
      updatedAt: now,
      updatedBy: userId,
      status: 'active',
      timezoneAtCreation: 'America/Los_Angeles',
    };

    tx.set(ref, payload, { merge: true });
    return { entryId, newSeg, ptDate, ptTime };
  });

  // Return hydrated view (mapEntry will reconstruct)
  const fresh = await dbService.getTimeEntry(userId, ptDate);
  if (!fresh) throw new Error('Punch in succeeded but read failed');
  return fresh;
}

/** Clock out the open segment. */
export async function punchOut(userId: string): Promise<TimeEntry> {
  const ptDate = getCurrentPTDate();
  const ptTime = getCurrentPTTimeHHMM();
  const now = Timestamp.now();
  const entryId = `${userId}_${ptDate}`;

  // Pre-check (UI should have guarded, but defense in depth)
  const pre = await dbService.getTimeEntry(userId, ptDate);
  const v = validateCanPunchOut(pre);
  if (!v.valid) throw new Error(v.message);

  const active = getActiveSegment(pre);
  if (!active) throw new Error('No active segment');

  const closedSeg = closeActiveSegment(active, ptTime, now.toMillis());

  // Write closed legacy + replace the open segment in the array with the closed one
  const archived = (pre?.segments || []).filter((s) => s.id !== active.id);
  const finalSegments = [...archived, closedSeg];

  await updateDoc(doc(db, 'timeEntries', entryId), {
    clockOutManual: ptTime,
    clockOutSystemTime: now,
    clockOutSystem: now.toMillis(),
    complete: true,
    currentStep: 4,
    dayComplete: true,
    completedAt: now.toMillis(),
    segments: finalSegments,
    totalWorkMinutes: (pre?.totalWorkMinutes || 0) + (closedSeg.workMinutes || 0),
    updatedAt: now,
    updatedBy: userId,
  } as any);

  const fresh = await dbService.getTimeEntry(userId, ptDate);
  if (!fresh) throw new Error('Punch out succeeded but read failed');
  return fresh;
}

/** Toggle lunch on the current open segment (start or end). */
export async function toggleLunch(userId: string, skip = false): Promise<TimeEntry> {
  const ptDate = getCurrentPTDate();
  const ptTime = getCurrentPTTimeHHMM();
  const now = Timestamp.now();
  const entryId = `${userId}_${ptDate}`;

  const pre = await dbService.getTimeEntry(userId, ptDate);
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
    s.id === active.id ? updatedSeg : s
  );
  patch.segments = newSegments;

  await updateDoc(doc(db, 'timeEntries', entryId), patch);

  const fresh = await dbService.getTimeEntry(userId, ptDate);
  if (!fresh) throw new Error('Lunch toggle succeeded but read failed');
  return fresh;
}

/** Rich status for the punch UI (today only). */
export async function getPunchStatus(userId: string): Promise<PunchStatus> {
  const ptDate = getCurrentPTDate();
  const ptTime = getCurrentPTTimeHHMM();
  const entry = await dbService.getTimeEntry(userId, ptDate);
  const active = getActiveSegment(entry);

  let todayTotal = 0;
  if (entry?.segments?.length) {
    todayTotal = entry.segments.reduce((sum, s) => sum + (s.workMinutes || 0), 0);
    if (active && !active.complete) {
      // Rough live estimate for open segment (no lunch yet)
      const inM = timeStringToMinutes(active.clockInManual || ptTime);
      const nowM = timeStringToMinutes(ptTime);
      todayTotal += Math.max(0, nowM - inM);
    }
  }

  const isOnLunch =
    !!active &&
    (active.lunchOutManual || active.lunchOutSystem) &&
    !(active.lunchInManual || active.lunchInSystem) &&
    !active.skipLunch;

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

/** This week's summary (PT week, Sunday start). */
export async function getWeekSummary(userId: string): Promise<WeekSummary> {
  const ptDate = getCurrentPTDate();
  const weekStart = getPTWeekStart(ptDate);
  // Simple 7-day window (inclusive)
  const weekEnd = getCurrentPTDate(); // today

  const entries = await dbService.getTimeEntriesForUserInRange(userId, weekStart, weekEnd);

  let total = 0;
  let daysWorked = 0;
  for (const e of entries) {
    const mins = e.segments?.reduce((s, seg) => s + (seg.workMinutes || 0), 0) || 0;
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
