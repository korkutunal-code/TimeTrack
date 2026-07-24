import { collection, doc, getDoc, getDocs, orderBy, query, Timestamp, updateDoc, where, limit, startAfter, deleteDoc, addDoc, setDoc } from 'firebase/firestore';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import type { User } from './auth';
import { stripUndefined, buildConsistentClosePatch, closeActiveSegment } from './segmentOps';
import { deriveSegmentWorkMinutes } from '../../utils/timeCalculations';
import { auditLogService } from '../../services/auditLogService';

/**
 * A single continuous work session ("shift"). A day may contain multiple
 * segments when the user pauses and resumes work (split shifts).
 * Legacy single-entry docs with no `segments[]` behave as a single-segment day.
 */
export interface TimeSegment {
  id: string;               // stable per-segment id (timestamp-based)
  clockInManual?: string;
  clockInSystem?: number;
  lunchOutManual?: string;
  lunchOutSystem?: number;
  lunchInManual?: string;
  lunchInSystem?: number;
  clockOutManual?: string;
  clockOutSystem?: number;
  skipLunch?: boolean;
  workMinutes?: number;     // minutes worked in this segment
  complete?: boolean;       // clockOut recorded
  taskId?: string;          // Dragme task id (optional)
  autoClosed?: boolean;     // set when watchdog auto-closes the segment
}

export interface TimeEntry {
  id: string;               // Firestore doc id (uid_date)
  userId: string;
  date: string;             // YYYY-MM-DD

  /** Split-shift segments for the day. Always populated (at least 1 for legacy). */
  segments?: TimeSegment[];

  clockInManual?: string;
  clockInSystem?: number;   // millis
  lunchOutManual?: string;
  lunchOutSystem?: number;  // millis
  lunchInManual?: string;
  lunchInSystem?: number;   // millis
  clockOutManual?: string;

  // Notification system locks to prevent repeated spams per day
  lunch_reminder_sent_at?: Timestamp | number | null;
  clockout_reminder_sent_at?: Timestamp | number | null;
  longshift_reminder_sent_at?: Timestamp | number | null;
  clockOutSystem?: number;  // millis

  skipLunch?: boolean;

  // Raw minutes stored in Firestore (used for payroll/audit calculations)
  totalWorkMinutes?: number;
  regularMinutes?: number;
  otMinutes?: number;
  doubleTimeMinutes?: number;

  totalHours?: number;
  regularHours?: number;
  overtimeHours?: number;   // 1.5x
  doubleTimeHours?: number; // 2x

  complete: boolean;
  flags?: string[];
  adminNotes?: string;
  currentStep: number;      // 0-4 (UI convenience)

  correctionRequested?: boolean;
  anomalyFlag?: boolean;

  /** Dragme task id (optional, dual-written at entry level by legacy flows). */
  taskId?: string | null;

  status?: 'active' | 'corrected' | 'voided' | 'archived';

  completedAt?: number;     // millis

  /** Synthesized current-segment view exposed by mapEntry (not persisted). */
  currentSegment?: TimeSegment | null;
}

export interface CorrectionRequest {
  id: string;
  employee_id: string;
  employee_name: string;
  requested_date: string;       // YYYY-MM-DD
  issue_type: string;
  notes: string;
  suggested_time?: string;

  // Before/After comparison
  original_clock_in?: string;
  original_clock_out?: string;
  original_lunch?: string;
  requested_clock_in?: string;
  requested_clock_out?: string;
  requested_lunch?: string;

  status: 'Open' | 'In Progress' | 'Resolved' | 'Rejected';
  resolution_note?: string;
  rejection_reason?: string;
  created_at: number;           // millis
  updated_at?: number;
  updated_by?: string;
}

type FirestoreTimeEntry = DocumentData;

/** Structural type for Firestore Timestamp-like values (avoids `any` casts). */
interface TimestampLike {
  toDate(): Date;
}

function tsToMillis(ts: unknown): number | undefined {
  if (!ts) return undefined;
  if (typeof ts === 'number') return ts;
  if (ts instanceof Date) return ts.getTime();
  if (ts && typeof (ts as TimestampLike).toDate === 'function') return (ts as TimestampLike).toDate().getTime();
  return undefined;
}

function minutesToHours(mins: unknown): number | undefined {
  if (mins === null || mins === undefined) return undefined;
  const n = Number(mins);
  if (Number.isNaN(n)) return undefined;
  return n / 60;
}

/** Compute minutes for the currently-active segment using its clock/lunch fields. */
function deriveCurrentSegmentMinutes(e: Partial<TimeEntry>, _archived: TimeSegment[]): number | undefined {
  // If totalWorkMinutes is present and this is a fresh single-segment doc, prefer it minus archived.
  if (!e.clockInManual) return undefined;
  if (e.clockOutManual) {
    // Delegate to the shared canonical helper so the lunch-aware arithmetic
    // stays identical to TodayEntry's submit flows. Returns undefined for open
    // shifts (no clockOut) so `current.workMinutes` is undefined and the
    // mapEntry override adds 0 via `?? 0`.
    return deriveSegmentWorkMinutes(
      e.clockInManual,
      e.clockOutManual,
      e.skipLunch,
      e.lunchOutManual,
      e.lunchInManual,
    );
  }
  return undefined;
}

export function mapEntry(id: string, data: FirestoreTimeEntry): TimeEntry {
  const date = String(data.workDate || data.date || '');
  const currentStepRaw = data.currentStep;
  const complete = data.dayComplete === true;
  const skipLunch = data.lunchSkipped === true;
  const currentStep =
    complete || currentStepRaw === 'complete'
      ? 4
      : typeof currentStepRaw === 'number'
        ? Math.max(0, Math.min(3, currentStepRaw - 1))
        : 0;

  const entry: TimeEntry = {
    id,
    userId: String(data.userId || ''),
    date,
    clockInManual: data.clockInManual || undefined,
    clockInSystem: tsToMillis(data.clockInSystemTime),
    lunchOutManual: data.lunchOutManual || undefined,
    lunchOutSystem: tsToMillis(data.lunchOutSystemTime),
    lunchInManual: data.lunchInManual || undefined,
    lunchInSystem: tsToMillis(data.lunchInSystemTime),
    clockOutManual: data.clockOutManual || undefined,
    lunch_reminder_sent_at: data.lunch_reminder_sent_at || null,
    clockout_reminder_sent_at: data.clockout_reminder_sent_at || null,
    longshift_reminder_sent_at: data.longshift_reminder_sent_at || null,
    clockOutSystem: tsToMillis(data.clockOutSystemTime),
    skipLunch,
    totalWorkMinutes: typeof data.totalWorkMinutes === 'number' ? data.totalWorkMinutes : undefined,
    regularMinutes: typeof data.regularMinutes === 'number' ? data.regularMinutes : undefined,
    otMinutes: typeof data.otMinutes === 'number' ? data.otMinutes : undefined,
    doubleTimeMinutes: typeof data.doubleTimeMinutes === 'number' ? data.doubleTimeMinutes : undefined,
    totalHours: minutesToHours(data.totalWorkMinutes),
    regularHours: minutesToHours(data.regularMinutes),
    overtimeHours: minutesToHours(data.otMinutes),
    doubleTimeHours: minutesToHours(data.doubleTimeMinutes),
    complete,
    currentStep,
    adminNotes: data.correctionNotes || data.notes || undefined,
    correctionRequested: data.correctionRequested === true,
    anomalyFlag: data.anomaly_flag === true,
    status: data.status || 'active',
    completedAt: tsToMillis(data.completedAt),
  };

  // --- Split-shift segments ---------------------------------------------
  // Firestore stores *archived* segments in `segments[]`; the current (active
  // or most-recently-completed) segment lives in the legacy top-level fields.
  // Hydrated entry.segments = [...archived, current (if present)].
  const archivedRaw = Array.isArray(data.segments) ? data.segments : [];
  const archived: TimeSegment[] = archivedRaw.map((s: DocumentData, i: number) => {
    const out: TimeSegment = {
      id: String(s.id ?? `${id}_arch_${i}`),
      clockInManual: s.clockInManual || undefined,
      clockInSystem: tsToMillis(s.clockInSystemTime ?? s.clockInSystem),
      lunchOutManual: s.lunchOutManual || undefined,
      lunchOutSystem: tsToMillis(s.lunchOutSystemTime ?? s.lunchOutSystem),
      lunchInManual: s.lunchInManual || undefined,
      lunchInSystem: tsToMillis(s.lunchInSystemTime ?? s.lunchInSystem),
      clockOutManual: s.clockOutManual || undefined,
      clockOutSystem: tsToMillis(s.clockOutSystemTime ?? s.clockOutSystem),
      skipLunch: s.skipLunch === true || s.lunchSkipped === true,
      workMinutes: typeof s.workMinutes === 'number' ? s.workMinutes : undefined,
      // The "complete: true" default was a relic of the assumption that
      // Firestore's `segments[]` is always archived. In practice, `punchIn`
      // dual-writes a fresh OPEN segment into `segments[]` (alongside the
      // legacy top-level fields). Forcing `complete: true` here hid the
      // open segment from getActiveSegment and caused the ClockPunch UI to
      // flip to "CLOCKED OUT" right after a successful clock-in. Respect the
      // segment's actual persisted value instead.
      complete: s.complete === true,
      autoClosed: s.autoClosed === true,
    };
    if (s.taskId) out.taskId = s.taskId; // omit when not set; never write undefined
    return out;
  });

  // S1: Fallback for dual-write divergence. Some docs end up with a complete
  // shift persisted in segments[] but the corresponding top-level manual
  // field missing (root clockOutManual not dual-written). Without this
  // fallback, HistoryView/TeamDashboard render "⚠️ Missing Clock Out" /
  // "Incomplete" for a valid closed shift. Resolve the effective manual
  // fields from the last persisted segment when the root field is absent.
  // Applied before `current` synthesis so the current-view also reflects
  // the real clock-out, and the existing coveredByArchived dedup keeps
  // totals correct (no double-count).
  const lastPersistedSeg = archived.length ? archived[archived.length - 1] : null;
  if (lastPersistedSeg) {
    if (!entry.clockInManual && lastPersistedSeg.clockInManual) entry.clockInManual = lastPersistedSeg.clockInManual;
    if (!entry.clockOutManual && lastPersistedSeg.clockOutManual) entry.clockOutManual = lastPersistedSeg.clockOutManual;
    if (!entry.lunchOutManual && lastPersistedSeg.lunchOutManual) entry.lunchOutManual = lastPersistedSeg.lunchOutManual;
    if (!entry.lunchInManual && lastPersistedSeg.lunchInManual) entry.lunchInManual = lastPersistedSeg.lunchInManual;
  }

  const current: TimeSegment | null = entry.clockInManual
    ? (() => {
        // Build the current segment WITHOUT undefined fields. Firestore rejects
        // any field with value `undefined`; if this segment is later written
        // back to the document (e.g. via toggleLunch's updateDoc), the whole
        // write fails. We use stripUndefined on the entry-derived fields then
        // force-include the always-present ones.
        const fromEntry: Partial<TimeSegment> = {
          clockInManual: entry.clockInManual,
          clockInSystem: entry.clockInSystem,
          lunchOutManual: entry.lunchOutManual,
          lunchOutSystem: entry.lunchOutSystem,
          lunchInManual: entry.lunchInManual,
          lunchInSystem: entry.lunchInSystem,
          clockOutManual: entry.clockOutManual,
          clockOutSystem: entry.clockOutSystem,
          skipLunch: entry.skipLunch,
          workMinutes: deriveCurrentSegmentMinutes(entry, archived),
        };
        const out: TimeSegment = {
          id: `${id}_current`,
          complete: !!entry.clockOutManual,
          autoClosed: data.autoClosed === true,
          ...stripUndefined(fromEntry),
        };
        if (data.taskId) out.taskId = data.taskId; // omit when not set
        return out;
      })()
    : null;

  // DEDUP: historical data has accumulated multiple `${id}_current` segments
  // because older versions of the code (and writes that round-trip through this
  // same mapEntry) appended a new current segment on every read. If we keep all
  // of them, every subsequent write to `segments` grows the array by one copy,
  // and Firestore's "no undefined" check fires because some legacy segments
  // don't have the fields our newer code expects. Keep only one segment per id,
  // preferring the LAST occurrence (most recent data).
  const dedup = (segs: TimeSegment[]): TimeSegment[] => {
    const byId = new Map<string, TimeSegment>();
    for (const s of segs) byId.set(s.id, s);
    return Array.from(byId.values());
  };

  // CRITICAL DESIGN NOTE:
  // `entry.segments` is meant to be the PERSISTED segments (the ones in the
  // Firestore document). The synthesized "current" is a *view* for UI / clock
  // state, NOT a stored object. If we put the synthesized current into
  // entry.segments, then every write (toggleLunch, punchOut) that uses
  // pre.segments as the source for the next write will round-trip the
  // synthesized current back to Firestore, growing the array indefinitely.
  //
  // So: entry.segments = persisted segments only. `current` is exposed on the
  // entry separately (see below) for UI components.
  if (current) {
    // The current segment is a view, not a stored object. Remove any
    // legacy `${id}_current` rows from the persisted list (older code wrote
    // them into segments[]).
    const persistedOnly = archived.filter((s) => s.id !== `${id}_current`);
    entry.segments = dedup(persistedOnly);
  } else {
    entry.segments = dedup(archived);
  }

  // Expose the current segment on the entry for UI consumers.
  entry.currentSegment = current;

  // Override day-level hours to include all archived segments too.
  if (archived.length > 0) {
    const archivedMins = archived.reduce((s, x) => s + (x.workMinutes || 0), 0);
    // The synthesized `current` (built from the top-level legacy fields) is a
    // *view* of the most-recent shift. In the ClockPunch flow that shift is
    // ALSO persisted as the last element of `archived` (dual-write), so adding
    // `current.workMinutes` again double-counts it — a 37-minute single shift
    // would render as "1:14" (74 min) in TodayEntry/HistoryView. In the
    // TodayEntry flow, the current shift lives ONLY in top-level fields (not
    // in segments[]) and must be added. Detect the dual-write case by checking
    // whether any archived seg covers the same shift as `current`.
    let currentMins = 0;
    if (current) {
      if (!current.complete) {
        // Open shift — not yet in archived, so its (live) minutes count once.
        currentMins = current.workMinutes ?? 0;
      } else {
        const coveredByArchived = archived.some(
          (s) =>
            s.clockInManual === current.clockInManual &&
            s.clockOutManual === current.clockOutManual,
        );
        currentMins = coveredByArchived ? 0 : (current.workMinutes ?? 0);
      }
    }
    entry.totalWorkMinutes = archivedMins + currentMins;
    entry.totalHours = entry.totalWorkMinutes / 60;
  }

  // S2: Display-fallback for closed shifts missing stored totals. A complete
  // entry with clock-in/out but no persisted totalWorkMinutes (legacy doc or
  // dual-write gap) would otherwise render "Incomplete" in HistoryView's
  // Total Hours cell. Derive from the manual fields so a valid closed shift
  // always shows a real total. NOTE: this mirrors calculateTotalHours, which
  // does not yet handle cross-midnight wraps — that is tracked separately
  // (S6) and is not made worse here.
  if (
    entry.complete &&
    entry.clockInManual &&
    entry.clockOutManual &&
    entry.totalWorkMinutes === undefined
  ) {
    const derivedMins = calculateTotalHours(entry) * 60;
    entry.totalWorkMinutes = derivedMins;
    entry.totalHours = derivedMins / 60;
  }

  // Flags are not stored in Firestore by default; compute basic flags for UI
  entry.flags = calculateFlags(entry);
  return entry;
}

// Segment operation helpers live in segmentOps.ts so they can be unit-tested
// without importing the firebase-firestore web SDK. Re-exported here for
// backward compat with existing callers.
export {
  stripUndefined,
  createInitialSegment,
  closeActiveSegment,
  applyLunchToSegment,
  getActiveSegment,
  hasOpenSegment,
  buildConsistentClosePatch,
} from './segmentOps';

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

export function calculateTotalHours(entry: Partial<TimeEntry>): number {
  if (!entry.clockInManual || !entry.clockOutManual) return 0;
  const clockIn = timeToMinutes(entry.clockInManual);
  const clockOut = timeToMinutes(entry.clockOutManual);
  // S6: cross-midnight wrap (see segmentOps.closeActiveSegment). A clock-out
  // earlier than clock-in means the shift crossed midnight; add 24h. Lunch
  // times are normalized against the same clock-in anchor so a midnight-
  // straddling lunch is subtracted correctly.
  const effClockOut = clockOut < clockIn ? clockOut + 24 * 60 : clockOut;
  let totalMinutes = effClockOut - clockIn;
  if (entry.lunchOutManual && entry.lunchInManual && !entry.skipLunch) {
    const lo = timeToMinutes(entry.lunchOutManual);
    const li = timeToMinutes(entry.lunchInManual);
    const effLo = lo < clockIn ? lo + 24 * 60 : lo;
    const effLi = li < clockIn ? li + 24 * 60 : li;
    totalMinutes -= Math.max(0, effLi - effLo);
  }
  return Math.max(0, totalMinutes / 60);
}

export function calculateFlags(entry: TimeEntry): string[] {
  const flags: string[] = [];
  if (!entry.complete) return flags;

  // Short/long lunch
  if (entry.lunchOutManual && entry.lunchInManual && !entry.skipLunch) {
    const duration = timeToMinutes(entry.lunchInManual) - timeToMinutes(entry.lunchOutManual);
    if (duration < 20) flags.push('short_lunch');
    if (duration > 90) flags.push('long_lunch');
  }

  // Very long/short day
  if (entry.totalHours !== undefined) {
    if (entry.totalHours > 11) flags.push('very_long_day');
    if (entry.totalHours > 0 && entry.totalHours < 4) flags.push('very_short_day');
  }

  // Anomalies detected at submission time by the user bypassing warnings
  if (entry.anomalyFlag) {
    flags.push('anomaly_detected');
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Punch segment helpers (Clock Agent owns — minimal addition for atomic punch flows)
// These are the canonical way to create/close segments in the TimeSegment model.
// New clockService.ts MUST use these + runTransaction for double-punch safety.
// Legacy flat fields are dual-written for backward compat with History/Payroll.
// ---------------------------------------------------------------------------

class DatabaseService {
  calculateTotalHours(entry: Partial<TimeEntry>): number {
    return calculateTotalHours(entry);
  }

  calculateFlags(entry: TimeEntry): string[] {
    return calculateFlags(entry);
  }

  async getTimeEntry(userId: string, date: string): Promise<TimeEntry | null> {
    const entryId = `${userId}_${date}`;
    const snap = await getDoc(doc(db, 'timeEntries', entryId));
    if (!snap.exists()) return null;
    return mapEntry(snap.id, snap.data());
  }

  async getTimeEntriesForUser(userId: string): Promise<TimeEntry[]> {
    const q = query(
      collection(db, 'timeEntries'),
      where('userId', '==', userId),
      orderBy('workDate', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => mapEntry(d.id, d.data()));
  }

  async getTimeEntriesForUserInRange(userId: string, startDate: string, endDate: string): Promise<TimeEntry[]> {
    const q = query(
      collection(db, 'timeEntries'),
      where('userId', '==', userId),
      where('workDate', '>=', startDate),
      where('workDate', '<=', endDate),
      orderBy('workDate', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => mapEntry(d.id, d.data()));
  }

  /**
   * Fetch all time entries, paginating through Firestore so we don't silently
   * truncate payroll at 500 docs. Returns ALL entries ordered by workDate desc.
   *
   * Cost: O(N) reads. The previous 500-cap silently dropped entries and broke
   * biweekly payroll for any company with more than ~5 weeks of history.
   */
  async getAllTimeEntries(): Promise<TimeEntry[]> {
    const PAGE_SIZE = 500;
    const all: TimeEntry[] = [];
    let lastDoc: QueryDocumentSnapshot<DocumentData> | null = null;

    // First page
    const firstQ = lastDoc
      ? query(collection(db, 'timeEntries'), orderBy('workDate', 'desc'), startAfter(lastDoc), limit(PAGE_SIZE))
      : query(collection(db, 'timeEntries'), orderBy('workDate', 'desc'), limit(PAGE_SIZE));
    let snap = await getDocs(firstQ);
    all.push(...snap.docs.map(d => mapEntry(d.id, d.data())));

    // Subsequent pages until exhausted
    while (snap.size === PAGE_SIZE) {
      lastDoc = snap.docs[snap.docs.length - 1];
      const nextQ = query(
        collection(db, 'timeEntries'),
        orderBy('workDate', 'desc'),
        startAfter(lastDoc),
        limit(PAGE_SIZE),
      );
      snap = await getDocs(nextQ);
      if (snap.empty) break;
      all.push(...snap.docs.map(d => mapEntry(d.id, d.data())));
    }

    return all;
  }

  async getAllUsers(): Promise<User[]> {
    const snap = await getDocs(collection(db, 'users'));
    return snap.docs.map(d => {
      const data = d.data();
      return {
        uid: d.id,
        email: String(data.email || ''),
        name: String(data.name || ''),
        role: String(data.role || 'employee').toLowerCase() as User['role'],
        active: data.active !== false,
        work_email: data.work_email,
        phone_number: data.phone_number,
        sms_opt_in: !!data.sms_opt_in,
        timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
        workModel: data.workModel === 'Remote' ? 'Remote' : 'On-site',
      };
    });
  }

  async updateUser(uid: string, updates: Partial<User>): Promise<User> {
    await updateDoc(doc(db, 'users', uid), {
      ...updates,
      updatedAt: new Date(),
    });
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) throw new Error('User not found');
    const data = snap.data();
    return {
      uid: snap.id,
      email: String(data.email || ''),
      name: String(data.name || ''),
      role: String(data.role || 'employee').toLowerCase() as User['role'],
      active: data.active !== false,
      work_email: data.work_email,
      phone_number: data.phone_number,
      sms_opt_in: !!data.sms_opt_in,
      timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      workModel: data.workModel === 'Remote' ? 'Remote' : 'On-site',
    };
  }

  async deleteUserProfile(uid: string): Promise<void> {
    await deleteDoc(doc(db, 'users', uid));
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) return null;
    const q = query(collection(db, 'users'), where('email', '==', normalizedEmail), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    const data = d.data();
    return {
      uid: d.id,
      email: String(data.email || ''),
      name: String(data.name || ''),
      role: String(data.role || 'employee').toLowerCase() as User['role'],
      active: data.active !== false,
      work_email: data.work_email,
      phone_number: data.phone_number,
      sms_opt_in: !!data.sms_opt_in,
      timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      workModel: data.workModel === 'Remote' ? 'Remote' : 'On-site',
    };
  }

  async updateTimeEntry(id: string, updates: Partial<TimeEntry>): Promise<TimeEntry> {
    // Only supports a subset of fields used in admin corrections in this React UI.
    const patch: Record<string, unknown> = { updatedAt: Timestamp.now() };
    if (updates.clockInManual !== undefined) patch.clockInManual = updates.clockInManual;
    if (updates.lunchOutManual !== undefined) patch.lunchOutManual = updates.lunchOutManual;
    if (updates.lunchInManual !== undefined) patch.lunchInManual = updates.lunchInManual;
    if (updates.clockOutManual !== undefined) patch.clockOutManual = updates.clockOutManual;
    if (updates.skipLunch !== undefined) patch.lunchSkipped = updates.skipLunch;
    if (updates.adminNotes !== undefined) patch.correctionNotes = updates.adminNotes;
    if (updates.correctionRequested !== undefined) patch.correctionRequested = updates.correctionRequested;
    await updateDoc(doc(db, 'timeEntries', id), patch);
    const snap = await getDoc(doc(db, 'timeEntries', id));
    if (!snap.exists()) throw new Error('Entry not found');
    return mapEntry(snap.id, snap.data());
  }

  /**
   * Quick-Edit direct adjustment (≤24h path). An employee directly updates one
   * manual time field on their own recent entry. Honors the mandatory-audit
   * rule (AGENTS.md / .kilo/rules/audit-mandatory-reason.md): writes an
   * immutable auditLogs entry FIRST (actorRole 'employee', permitted by the
   * widened self-audit rule), then mutates timeEntries. Dual-writes the
   * matching segment field + recomputes totalWorkMinutes for closed shifts via
   * the S7 `buildConsistentClosePatch` helper so root/segments/total never
   * diverge. Open shifts just update the active segment's manual field.
   *
   * The 24h threshold itself is enforced by the caller (TimeAdjustmentModal)
   * using each field's `*System` millis — this method does not re-check age,
   * it only performs the edit + audit once invoked.
   */
  async directEditTimeField(args: {
    userId: string;
    actorName?: string;
    entryId: string;
    field: 'clockInManual' | 'lunchOutManual' | 'lunchInManual' | 'clockOutManual';
    value: string; // HH:MM
    reason: string;
  }): Promise<TimeEntry> {
    const { userId, actorName, entryId, field, value, reason } = args;
    const trimmedReason = (reason || '').trim();
    if (!trimmedReason) throw new Error('A reason is required to adjust a time.');

    // Read authoritative "before" snapshot.
    const beforeSnap = await getDoc(doc(db, 'timeEntries', entryId));
    if (!beforeSnap.exists()) throw new Error('Entry not found.');
    const before = mapEntry(entryId, beforeSnap.data());

    // Own-entry guard (defense-in-depth; rules also allow self-update only).
    if (before.userId !== userId) {
      throw new Error('You can only edit your own time entries.');
    }

    const beforeFieldVal = before[field] ?? null;

    // Build the "after" view with the edited top-level field.
    const after: TimeEntry = { ...before, [field]: value };
    const hasClockOut = !!after.clockOutManual;

    // Dual-write the matching segment field (S7 contract).
    let segments = before.segments ? before.segments.map((s) => ({ ...s })) : [];
    if (hasClockOut && after.clockInManual) {
      // Closed shift: rebuild segments consistently + recompute total (replace
      // mode collapses to the single corrected shift, matching admin UX).
      const closePatch = buildConsistentClosePatch({
        clockIn: after.clockInManual,
        clockOut: after.clockOutManual,
        skipLunch: !!after.skipLunch,
        lunchOut: after.skipLunch ? undefined : (after.lunchOutManual || undefined),
        lunchIn: after.skipLunch ? undefined : (after.lunchInManual || undefined),
        clockOutSystem: before.clockOutSystem ?? Date.now(),
        existingSegments: segments,
        mode: 'replace',
      });
      segments = closePatch.segments;
      after.totalWorkMinutes = closePatch.totalWorkMinutes;
      after.totalHours = closePatch.totalWorkMinutes / 60;
    } else {
      // Open shift: update the active (incomplete) segment's manual field;
      // total is derived live by mapEntry, so don't persist a total here.
      const activeIdx = segments.findIndex((s) => !s.complete);
      if (activeIdx >= 0) {
        segments[activeIdx][field] = value;
      }
    }

    // 1) Audit FIRST (mandatory, non-bypassable). Employee self-audit.
    await auditLogService.logTimeCorrection({
      actorUid: userId,
      actorName,
      actorRole: 'employee',
      targetId: entryId,
      before: {
        [field]: beforeFieldVal,
        totalWorkMinutes: before.totalWorkMinutes,
        status: before.status,
      },
      after: {
        [field]: value,
        totalWorkMinutes: after.totalWorkMinutes,
        status: 'corrected',
      },
      reason: trimmedReason,
    });

    // 2) Only after the durable audit row exists, mutate the time record.
    await updateDoc(doc(db, 'timeEntries', entryId), {
      [field]: value,
      segments: segments.map((s) => stripUndefined(s)),
      ...(hasClockOut
        ? { totalWorkMinutes: after.totalWorkMinutes, totalHours: after.totalHours }
        : {}),
      status: 'corrected',
      updatedAt: Timestamp.now(),
      updatedBy: userId,
    });

    // Re-read + return hydrated view.
    const freshSnap = await getDoc(doc(db, 'timeEntries', entryId));
    if (!freshSnap.exists()) throw new Error('Entry not found after update.');
    return mapEntry(entryId, freshSnap.data());
  }

  /**
   * Segment-targeted direct edit (≤24h path, multi-shift safe). Updates a
   * single segment's manual time field in `segments[]` WITHOUT collapsing
   * other shifts (unlike directEditTimeField's replace mode). Recomputes the
   * edited segment's workMinutes (S6 cross-midnight-aware via
   * closeActiveSegment) and the day's totalWorkMinutes. If the edited segment
   * mirrors the top-level fields (is the current/last segment), the top-level
   * field is also updated so root and segments stay in sync.
   */
  async directEditSegmentField(args: {
    userId: string;
    actorName?: string;
    entryId: string;
    segmentId: string;
    field: 'clockInManual' | 'lunchOutManual' | 'lunchInManual' | 'clockOutManual';
    value: string;
    reason: string;
  }): Promise<TimeEntry> {
    const { userId, actorName, entryId, segmentId, field, value, reason } = args;
    const trimmedReason = (reason || '').trim();
    if (!trimmedReason) throw new Error('A reason is required to adjust a time.');

    const beforeSnap = await getDoc(doc(db, 'timeEntries', entryId));
    if (!beforeSnap.exists()) throw new Error('Entry not found.');
    const before = mapEntry(entryId, beforeSnap.data());

    if (before.userId !== userId) {
      throw new Error('You can only edit your own time entries.');
    }

    // Find the target segment: in persisted segments[] or the synthesized current.
    const persistedSegs = before.segments ? before.segments.map((s) => ({ ...s })) : [];
    const currentSeg = before.currentSegment ?? null;

    let targetIdx = persistedSegs.findIndex((s) => s.id === segmentId);
    let targetSeg: TimeSegment | null = null;
    if (targetIdx >= 0) {
      targetSeg = persistedSegs[targetIdx];
    } else if (currentSeg && currentSeg.id === segmentId) {
      targetSeg = currentSeg;
    }
    if (!targetSeg) {
      throw new Error('Shift not found. It may have been modified.');
    }

    const beforeFieldVal = targetSeg[field] ?? null;

    // Build the edited segment.
    const editedSeg: TimeSegment = { ...targetSeg, [field]: value };

    // If complete, recompute workMinutes (S6 cross-midnight-aware).
    if (editedSeg.complete && editedSeg.clockOutManual) {
      const openForRecompute: TimeSegment = {
        ...editedSeg,
        complete: false,
        workMinutes: undefined,
      };
      const recomputed = closeActiveSegment(
        openForRecompute,
        editedSeg.clockOutManual,
        editedSeg.clockOutSystem ?? 0,
        editedSeg.skipLunch ?? false,
      );
      editedSeg.workMinutes = recomputed.workMinutes;
    }

    // Rebuild the segments array — update the target in-place if persisted,
    // or update the matching open segment if the target was the synthesized current.
    let newSegments: TimeSegment[];
    if (targetIdx >= 0) {
      newSegments = persistedSegs.map((s, i) => (i === targetIdx ? editedSeg : s));
    } else {
      // The current segment — may be dual-written as an open segment in segments[].
      const openIdx = persistedSegs.findIndex((s) => !s.complete);
      if (openIdx >= 0) {
        newSegments = persistedSegs.map((s, i) =>
          i === openIdx
            ? { ...s, [field]: value, ...(editedSeg.complete ? { workMinutes: editedSeg.workMinutes } : {}) }
            : s,
        );
      } else {
        newSegments = [...persistedSegs, editedSeg];
      }
    }

    // Recompute day total from all complete segments.
    const totalWorkMinutes = newSegments.reduce(
      (sum, s) => sum + (s.complete ? s.workMinutes || 0 : 0),
      0,
    );

    // Update top-level field if the target mirrors it (current segment or
    // last persisted segment whose clockIn matches the root).
    const isCurrent = currentSeg && segmentId === currentSeg.id;
    const isLastMirroring =
      targetIdx >= 0 &&
      targetIdx === persistedSegs.length - 1 &&
      before.clockInManual === targetSeg.clockInManual;
    const updateTopLevel = isCurrent || isLastMirroring;

    const patch: Record<string, unknown> = {
      segments: newSegments.map((s) => stripUndefined(s)),
      totalWorkMinutes,
      status: 'corrected',
      updatedAt: Timestamp.now(),
      updatedBy: userId,
    };
    if (updateTopLevel) {
      patch[field] = value;
    }

    // 1) Audit FIRST (mandatory, non-bypassable).
    await auditLogService.logTimeCorrection({
      actorUid: userId,
      actorName,
      actorRole: 'employee',
      targetId: entryId,
      before: { segmentId, [field]: beforeFieldVal, totalWorkMinutes: before.totalWorkMinutes },
      after: { segmentId, [field]: value, totalWorkMinutes },
      reason: trimmedReason,
    });

    // 2) Mutate time record.
    await updateDoc(doc(db, 'timeEntries', entryId), patch);

    // Re-read + return hydrated view.
    const freshSnap = await getDoc(doc(db, 'timeEntries', entryId));
    if (!freshSnap.exists()) throw new Error('Entry not found after update.');
    return mapEntry(entryId, freshSnap.data());
  }

  /**
   * Retroactive direct shift close (≤24h path). Closes an OPEN segment by
   * setting its clock-out, computing workMinutes (S6 cross-midnight-aware via
   * closeActiveSegment), setting the day-completion flags, and recomputing
   * the day total. Writes the mandatory audit log FIRST (employee self-audit),
   * then mutates timeEntries.
   *
   * The 24h threshold is checked by the caller (TimeAdjustmentModal) using the
   * segment's clockInSystem — this method performs the close once invoked.
   */
  async directCloseShift(args: {
    userId: string;
    actorName?: string;
    entryId: string;
    segmentId: string;
    clockOut: string; // HH:MM
    reason: string;
  }): Promise<TimeEntry> {
    const { userId, actorName, entryId, segmentId, clockOut, reason } = args;
    const trimmedReason = (reason || '').trim();
    if (!trimmedReason) throw new Error('A reason is required to close a shift.');

    const beforeSnap = await getDoc(doc(db, 'timeEntries', entryId));
    if (!beforeSnap.exists()) throw new Error('Entry not found.');
    const before = mapEntry(entryId, beforeSnap.data());

    if (before.userId !== userId) {
      throw new Error('You can only edit your own time entries.');
    }

    // Find the target segment.
    const persistedSegs = before.segments ? before.segments.map((s) => ({ ...s })) : [];
    const currentSeg = before.currentSegment ?? null;

    let targetIdx = persistedSegs.findIndex((s) => s.id === segmentId);
    let targetSeg: TimeSegment | null = null;
    if (targetIdx >= 0) {
      targetSeg = persistedSegs[targetIdx];
    } else if (currentSeg && currentSeg.id === segmentId) {
      targetSeg = currentSeg;
    }
    if (!targetSeg) throw new Error('Shift not found. It may have been modified.');

    // Guard on the actual clock-out value, not the `complete` flag. A doc may
    // carry a stale/contradictory `complete` flag while still lacking a
    // clock-out (the case TimeAdjustmentModal's retroactive-close entry
    // explicitly handles). `closeActiveSegment` always sets `clockOutManual`
    // when it closes a segment, so a truthy value here reliably means the
    // shift was genuinely closed — and a stale-flagged-but-clock-out-less
    // segment can be closed without a confusing late rejection.
    if (targetSeg.clockOutManual) throw new Error('This shift is already closed.');
    if (!targetSeg.clockInManual) throw new Error('Cannot close a shift without a clock-in time.');

    // Validate clock-out is chronologically later than clock-in (S6
    // cross-midnight-aware: if outM < inM, the shift crossed midnight and we
    // add 24h; after that, outM must still be > inM).
    const inM = timeToMinutes(targetSeg.clockInManual);
    const outM = timeToMinutes(clockOut);
    const effOutM = outM < inM ? outM + 24 * 60 : outM;
    if (effOutM <= inM) {
      throw new Error('Clock-out time must be later than the clock-in time.');
    }

    const beforeFieldVal = targetSeg.clockOutManual ?? null;
    const now = Timestamp.now();

    // Close the segment via the canonical helper (S6 wrap + lunch deduction).
    const closedSeg = closeActiveSegment(
      targetSeg,
      clockOut,
      now.toMillis(),
      targetSeg.skipLunch ?? false,
    );

    // Rebuild segments — update the target in-place if persisted, or update
    // the matching open segment if the target was the synthesized current.
    let newSegments: TimeSegment[];
    if (targetIdx >= 0) {
      newSegments = persistedSegs.map((s, i) => (i === targetIdx ? closedSeg : s));
    } else {
      const openIdx = persistedSegs.findIndex((s) => !s.complete);
      if (openIdx >= 0) {
        newSegments = persistedSegs.map((s, i) => (i === openIdx ? closedSeg : s));
      } else {
        newSegments = [...persistedSegs, closedSeg];
      }
    }

    // Recompute day total from all complete segments.
    const totalWorkMinutes = newSegments.reduce(
      (sum, s) => sum + (s.complete ? s.workMinutes || 0 : 0),
      0,
    );

    // 1) Audit FIRST (mandatory, non-bypassable). Employee self-audit.
    await auditLogService.logTimeCorrection({
      actorUid: userId,
      actorName,
      actorRole: 'employee',
      action: 'time_correction',
      targetId: entryId,
      before: { clockOutManual: beforeFieldVal, totalWorkMinutes: before.totalWorkMinutes, status: before.status },
      after: { clockOutManual: clockOut, totalWorkMinutes, status: 'corrected' },
      reason: trimmedReason,
    });

    // 2) Mutate the timeEntries doc — close the shift + set completion flags.
    await updateDoc(doc(db, 'timeEntries', entryId), {
      clockOutManual: clockOut,
      clockOutSystem: now.toMillis(),
      clockOutSystemTime: now,
      segments: newSegments.map((s) => stripUndefined(s)),
      totalWorkMinutes,
      totalHours: totalWorkMinutes / 60,
      complete: true,
      dayComplete: true,
      currentStep: 4,
      completedAt: now.toMillis(),
      status: 'corrected',
      updatedAt: now,
      updatedBy: userId,
    });

    // Re-read + return hydrated view.
    const freshSnap = await getDoc(doc(db, 'timeEntries', entryId));
    if (!freshSnap.exists()) throw new Error('Entry not found after update.');
    return mapEntry(entryId, freshSnap.data());
  }

  /**
   * Retroactive direct lunch-end (≤24h path). Ends an in-progress lunch on an
   * OPEN segment by setting lunchIn + lunchInSystem, WITHOUT closing the shift
   * (the employee continues working). Validates lunchIn > lunchOut (S6
   * cross-midnight-aware). Writes the mandatory audit log FIRST (employee
   * self-audit), then mutates timeEntries.
   *
   * The 24h threshold is checked by the caller (TimeAdjustmentModal) using the
   * segment's lunchOutSystem — this method performs the end-lunch once invoked.
   */
  async directEndLunch(args: {
    userId: string;
    actorName?: string;
    entryId: string;
    segmentId: string;
    lunchIn: string; // HH:MM
    reason: string;
  }): Promise<TimeEntry> {
    const { userId, actorName, entryId, segmentId, lunchIn, reason } = args;
    const trimmedReason = (reason || '').trim();
    if (!trimmedReason) throw new Error('A reason is required to end lunch.');

    const beforeSnap = await getDoc(doc(db, 'timeEntries', entryId));
    if (!beforeSnap.exists()) throw new Error('Entry not found.');
    const before = mapEntry(entryId, beforeSnap.data());

    if (before.userId !== userId) {
      throw new Error('You can only edit your own time entries.');
    }

    // Find the target segment.
    const persistedSegs = before.segments ? before.segments.map((s) => ({ ...s })) : [];
    const currentSeg = before.currentSegment ?? null;

    let targetIdx = persistedSegs.findIndex((s) => s.id === segmentId);
    let targetSeg: TimeSegment | null = null;
    if (targetIdx >= 0) {
      targetSeg = persistedSegs[targetIdx];
    } else if (currentSeg && currentSeg.id === segmentId) {
      targetSeg = currentSeg;
    }
    if (!targetSeg) throw new Error('Shift not found. It may have been modified.');

    if (targetSeg.complete) throw new Error('Cannot end lunch on a closed shift.');
    if (!targetSeg.lunchOutManual) throw new Error('No lunch break was started on this shift.');
    if (targetSeg.lunchInManual) throw new Error('Lunch has already ended on this shift.');

    // Validate lunchIn > lunchOut (S6 cross-midnight-aware).
    const lunchOutM = timeToMinutes(targetSeg.lunchOutManual);
    const lunchInM = timeToMinutes(lunchIn);
    const effLunchInM = lunchInM < lunchOutM ? lunchInM + 24 * 60 : lunchInM;
    if (effLunchInM <= lunchOutM) {
      throw new Error('Lunch-in time must be later than the lunch-out time.');
    }

    const beforeFieldVal = targetSeg.lunchInManual ?? null;
    const now = Timestamp.now();

    // Update the segment with lunchIn + system timestamp. Segment stays OPEN.
    const updatedSeg: TimeSegment = {
      ...targetSeg,
      lunchInManual: lunchIn,
      lunchInSystem: now.toMillis(),
      complete: false,
    };

    // Rebuild segments — update the target in-place.
    let newSegments: TimeSegment[];
    if (targetIdx >= 0) {
      newSegments = persistedSegs.map((s, i) => (i === targetIdx ? updatedSeg : s));
    } else {
      const openIdx = persistedSegs.findIndex((s) => !s.complete);
      if (openIdx >= 0) {
        newSegments = persistedSegs.map((s, i) => (i === openIdx ? updatedSeg : s));
      } else {
        newSegments = [...persistedSegs, updatedSeg];
      }
    }

    // Determine if the top-level field should be synced (current segment or
    // last-mirroring segment, same logic as directEditSegmentField).
    const isCurrent = currentSeg && segmentId === currentSeg.id;
    const isLastMirroring =
      targetIdx >= 0 &&
      targetIdx === persistedSegs.length - 1 &&
      before.clockInManual === targetSeg.clockInManual;
    const updateTopLevel = isCurrent || isLastMirroring;

    // 1) Audit FIRST (mandatory, non-bypassable). Employee self-audit.
    await auditLogService.logTimeCorrection({
      actorUid: userId,
      actorName,
      actorRole: 'employee',
      action: 'time_correction',
      targetId: entryId,
      before: { lunchInManual: beforeFieldVal, totalWorkMinutes: before.totalWorkMinutes, status: before.status },
      after: { lunchInManual: lunchIn, totalWorkMinutes: before.totalWorkMinutes, status: 'corrected' },
      reason: trimmedReason,
    });

    // 2) Mutate the timeEntries doc. The shift stays open (no completion
    //    flags); only the lunch-in field + segment are updated.
    const patch: Record<string, unknown> = {
      segments: newSegments.map((s) => stripUndefined(s)),
      status: 'corrected',
      updatedAt: now,
      updatedBy: userId,
    };
    if (updateTopLevel) {
      patch.lunchInManual = lunchIn;
      patch.lunchInSystemTime = now;
      patch.lunchInSystem = now.toMillis();
    }
    await updateDoc(doc(db, 'timeEntries', entryId), patch);

    // Re-read + return hydrated view.
    const freshSnap = await getDoc(doc(db, 'timeEntries', entryId));
    if (!freshSnap.exists()) throw new Error('Entry not found after update.');
    return mapEntry(entryId, freshSnap.data());
  }

  /** Active (un-resolved) correction requests for a user — for badge display. */
  async getActiveCorrectionRequestsForUser(userId: string): Promise<CorrectionRequest[]> {
    const all = await this.getCorrectionRequestsForUser(userId);
    const active: CorrectionRequest['status'][] = ['Open', 'In Progress'];
    return all.filter((r) => active.includes(r.status));
  }

  // ---- Correction Requests ----

  async createCorrectionRequest(data: Omit<CorrectionRequest, 'id'>): Promise<string> {
    // Sanitize: Firestore addDoc() rejects `undefined` field values. Optional
    // fields (requested_lunch, suggested_time, original_*, resolution_note,
    // updated_by, etc.) arrive as `undefined` when the caller omits them — e.g.
    // a non-lunch Clock Out request leaves `requested_lunch: undefined`, which
    // throws "Unsupported field value: undefined". Strip all undefined keys
    // before write so any correction request saves cleanly.
    const payload: Record<string, unknown> = { ...data, created_at: Timestamp.now() };
    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined) delete payload[key];
    }
    const docRef = await addDoc(collection(db, 'correctionRequests'), payload);
    return docRef.id;
  }

  async getCorrectionRequestsForUser(userId: string): Promise<CorrectionRequest[]> {
    const q = query(
      collection(db, 'correctionRequests'),
      where('employee_id', '==', userId),
      orderBy('created_at', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        employee_id: data.employee_id,
        employee_name: data.employee_name || '',
        requested_date: data.requested_date,
        issue_type: data.issue_type,
        notes: data.notes,
        suggested_time: data.suggested_time || undefined,
        original_clock_in: data.original_clock_in || undefined,
        original_clock_out: data.original_clock_out || undefined,
        original_lunch: data.original_lunch || undefined,
        requested_clock_in: data.requested_clock_in || undefined,
        requested_clock_out: data.requested_clock_out || undefined,
        requested_lunch: data.requested_lunch || undefined,
        status: data.status || 'Open',
        resolution_note: data.resolution_note || undefined,
        rejection_reason: data.rejection_reason || undefined,
        created_at: tsToMillis(data.created_at) || Date.now(),
        updated_at: tsToMillis(data.updated_at) || undefined,
        updated_by: data.updated_by || undefined,
      } as CorrectionRequest;
    });
  }

  async getAllCorrectionRequests(): Promise<CorrectionRequest[]> {
    const q = query(
      collection(db, 'correctionRequests'),
      orderBy('created_at', 'desc'),
      limit(500)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        employee_id: data.employee_id,
        employee_name: data.employee_name || '',
        requested_date: data.requested_date,
        issue_type: data.issue_type,
        notes: data.notes,
        suggested_time: data.suggested_time || undefined,
        original_clock_in: data.original_clock_in || undefined,
        original_clock_out: data.original_clock_out || undefined,
        original_lunch: data.original_lunch || undefined,
        requested_clock_in: data.requested_clock_in || undefined,
        requested_clock_out: data.requested_clock_out || undefined,
        requested_lunch: data.requested_lunch || undefined,
        status: data.status || 'Open',
        resolution_note: data.resolution_note || undefined,
        rejection_reason: data.rejection_reason || undefined,
        created_at: tsToMillis(data.created_at) || Date.now(),
        updated_at: tsToMillis(data.updated_at) || undefined,
        updated_by: data.updated_by || undefined,
      } as CorrectionRequest;
    });
  }

  /**
   * Resolve a correction request AND apply the time change.
   *
   * When status === 'Resolved': maps issue_type to the target timeEntries
   * field, updates the matching segment via buildConsistentClosePatch (S7
   * dual-write + S6 cross-midnight), recomputes totalWorkMinutes, writes the
   * mandatory auditLogs entry (action 'admin_correction_approved') FIRST, then
   * mutates timeEntries, then finally marks the correctionRequests doc as
   * Resolved.
   *
   * Ordering & failure semantics (NOT a Firestore transaction — auditLogs is
   * append-only/immutable so it cannot be rolled back):
   *  - Audit is written FIRST as a durable precondition. This is intentional:
   *    the mandatory-audit guardrail (AGENTS.md / .kilo/rules) prioritizes
   *    "never change a time record without an audit entry existing" over
   *    "never have an audit entry without a time change." An orphaned audit
   *    (audit exists, time write failed) is the SAFE failure mode — it records
   *    that an admin attempted this correction, and the request stays
   *    un-Resolved so the admin sees the error and can retry.
   *  - If the timeEntries write (step 7) succeeds but the correctionRequests
   *    status write (step 8) fails, the time change persists and the request
   *    stays un-Resolved. The admin can retry or manually mark it Resolved.
   *    This is preferable to a transaction that would roll back the time
   *    change on a transient request-status write failure.
   *
   * For 'In Progress' / 'Rejected' (non-Resolved) statuses, only the
   * correctionRequests doc is updated (no time-entry mutation).
   */
  async resolveCorrectionRequest(args: {
    requestId: string;
    adminUid: string;
    adminName?: string;
    newStatus: CorrectionRequest['status'];
    resolutionNote: string;
  }): Promise<void> {
    const { requestId, adminUid, adminName, newStatus, resolutionNote } = args;
    const trimmedNote = (resolutionNote || '').trim();
    if (!trimmedNote) throw new Error('A resolution note is required.');

    // 1) Read the correction request to get the target field + suggested time.
    const reqSnap = await getDoc(doc(db, 'correctionRequests', requestId));
    if (!reqSnap.exists()) throw new Error('Correction request not found.');
    const reqData = reqSnap.data();
    const request = {
      id: requestId,
      employee_id: reqData.employee_id,
      requested_date: reqData.requested_date,
      issue_type: reqData.issue_type,
      suggested_time: reqData.suggested_time || undefined,
      requested_clock_in: reqData.requested_clock_in || undefined,
      requested_clock_out: reqData.requested_clock_out || undefined,
      requested_lunch: reqData.requested_lunch || undefined,
      notes: reqData.notes || '',
      status: reqData.status || 'Open',
    };

    // 2) If not Resolved, just update the request doc (no time-entry mutation).
    if (newStatus !== 'Resolved') {
      const patch: Record<string, unknown> = {
        status: newStatus,
        updated_at: Timestamp.now(),
        updated_by: adminUid,
      };
      if (newStatus === 'Rejected') {
        patch.rejection_reason = trimmedNote;
      } else {
        patch.resolution_note = trimmedNote;
      }
      await updateDoc(doc(db, 'correctionRequests', requestId), patch);
      return;
    }

    // 3) Resolved: apply the time change. Map issue_type → field + value.
    const entryId = `${request.employee_id}_${request.requested_date}`;
    const issueTypeToField: Record<string, 'clockInManual' | 'lunchOutManual' | 'lunchInManual' | 'clockOutManual'> = {
      'Clock In': 'clockInManual',
      'Lunch Out': 'lunchOutManual',
      'Lunch In': 'lunchInManual',
      'Clock Out': 'clockOutManual',
    };
    const field = issueTypeToField[request.issue_type];
    if (!field) {
      throw new Error(`Cannot apply change for issue type "${request.issue_type}". Update the time entry manually.`);
    }
    // Resolve the suggested value: prefer suggested_time, fall back to the
    // requested_* field matching the issue_type.
    let value: string | undefined = request.suggested_time;
    if (!value) {
      if (field === 'clockInManual') value = request.requested_clock_in;
      else if (field === 'clockOutManual') value = request.requested_clock_out;
      else if (field === 'lunchOutManual' || field === 'lunchInManual') {
        // requested_lunch may be "HH:MM - HH:MM" or a single time.
        if (request.requested_lunch) {
          const parts = request.requested_lunch.split('-').map((s: string) => s.trim());
          value = field === 'lunchOutManual' ? parts[0] : parts[1] || parts[0];
        }
      }
    }
    if (!value) {
      throw new Error('No suggested/requested time found in the correction request.');
    }

    // 4) Read the target timeEntries doc.
    const beforeSnap = await getDoc(doc(db, 'timeEntries', entryId));
    if (!beforeSnap.exists()) {
      throw new Error(`Time entry not found for ${request.employee_id} on ${request.requested_date}. Create it first or update manually.`);
    }
    const before = mapEntry(entryId, beforeSnap.data());
    const beforeFieldVal = before[field] ?? null;

    // 5) Build the after view + dual-write segments via S7 helper.
    const after: TimeEntry = { ...before, [field]: value };
    let segments = before.segments ? before.segments.map((s) => ({ ...s })) : [];
    const hasClockOut = !!after.clockOutManual;
    if (hasClockOut && after.clockInManual) {
      const closePatch = buildConsistentClosePatch({
        clockIn: after.clockInManual,
        clockOut: after.clockOutManual,
        skipLunch: !!after.skipLunch,
        lunchOut: after.skipLunch ? undefined : (after.lunchOutManual || undefined),
        lunchIn: after.skipLunch ? undefined : (after.lunchInManual || undefined),
        clockOutSystem: before.clockOutSystem ?? Date.now(),
        clockInSystem: before.clockInSystem,
        existingSegments: segments,
        // 'append' preserves prior archived split-shift segments. 'replace'
        // would collapse them, destroying other shifts' segments + totals.
        mode: 'append',
      });
      segments = closePatch.segments;
      after.totalWorkMinutes = closePatch.totalWorkMinutes;
      after.totalHours = closePatch.totalWorkMinutes / 60;
    } else {
      const activeIdx = segments.findIndex((s) => !s.complete);
      if (activeIdx >= 0) segments[activeIdx][field] = value;
    }

    // 6) Audit FIRST (mandatory, non-bypassable). Admin action.
    await auditLogService.logTimeCorrection({
      actorUid: adminUid,
      actorName: adminName,
      actorRole: 'admin',
      action: 'admin_correction_approved',
      targetId: entryId,
      before: { field, [field]: beforeFieldVal, totalWorkMinutes: before.totalWorkMinutes },
      after: { field, [field]: value, totalWorkMinutes: after.totalWorkMinutes },
      reason: `${trimmedNote} (approved correction request ${requestId} for ${request.issue_type})`,
      correctionRequestId: requestId,
    });

    // 7) Mutate the timeEntries doc. When the edit closes a shift (clock-out
    // present), set the day-completion flags so mapEntry (which derives
    // completeness from dayComplete) renders the entry as Complete — without
    // these, an admin-approved clock-out would still show as "Incomplete/Open".
    await updateDoc(doc(db, 'timeEntries', entryId), {
      [field]: value,
      segments: segments.map((s) => stripUndefined(s)),
      ...(hasClockOut
        ? {
            totalWorkMinutes: after.totalWorkMinutes,
            totalHours: after.totalHours,
            complete: true,
            dayComplete: true,
            currentStep: 4,
            completedAt: Date.now(),
          }
        : {}),
      status: 'corrected',
      updatedAt: Timestamp.now(),
      updatedBy: adminUid,
    });

    // 8) Only after timeEntries is updated, mark the correction request Resolved.
    await updateDoc(doc(db, 'correctionRequests', requestId), {
      status: 'Resolved',
      resolution_note: trimmedNote,
      updated_at: Timestamp.now(),
      updated_by: adminUid,
    });
  }

  async updateCorrectionRequest(id: string, updates: Partial<CorrectionRequest>): Promise<void> {
    const patch: Record<string, unknown> = { updated_at: Timestamp.now() };
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.resolution_note !== undefined) patch.resolution_note = updates.resolution_note;
    if (updates.rejection_reason !== undefined) patch.rejection_reason = updates.rejection_reason;
    if (updates.updated_by !== undefined) patch.updated_by = updates.updated_by;
    await updateDoc(doc(db, 'correctionRequests', id), patch);
  }

  async getPayrollSettings(): Promise<DocumentData | null> {
    const snap = await getDoc(doc(db, 'systemSettings', 'payroll'));
    if (snap.exists()) {
      return snap.data();
    }
    return null;
  }

  async setPayrollLock(dateStr: string, adminId: string): Promise<void> {
    await setDoc(doc(db, 'systemSettings', 'payroll'), {
      locked_up_to_date: dateStr,
      locked_at: Timestamp.now(),
      locked_by: adminId
    }, { merge: true });
  }
}

export const dbService = new DatabaseService();