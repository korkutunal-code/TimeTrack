/**
 * One-time admin repair utility for historical runaway entries.
 *
 * Runs client-side under the signed-in admin (org policy blocks deploying
 * public callable invokers, and firestore.rules already allow admins to
 * update any timeEntry + append auditLogs — the same path "Correct Entry"
 * uses).
 *
 * Policy (mirrors the server-side autoGuardrails cron):
 *   - On-site: cap any shift segment at 10:00 PM local (next local day when
 *     the clock-in itself was after 10 PM).
 *   - Remote: cap any shift segment at 12 hours from its clock-in.
 *
 * BOTH still-open entries and completed entries (dayComplete === true) are
 * inspected: a completed entry whose segment ran past the cap (e.g. a 24-hour
 * "completed" runaway) is flagged and capped the same way.
 *
 * Totals are recomputed via the canonical read-side SSOT `getEntryTotals`
 * (AGENTS.md), the entry is flagged/autoClosed, and every repair appends an
 * immutable auditLogs row with a mandatory reason (audit-mandatory-reason
 * rule). Soft-update only — nothing is ever deleted.
 */
import { collection, doc, getDocs, query, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../app/lib/firebase';
import { getEntryTotals, type TimeEntry } from '../app/lib/database';
import { getTimeZoneOffsetMs, localDateOf, localTimeHHMM, nextLocalMidnightMs } from '../utils/midnightSplit';
import { auditLogService } from './auditLogService';
import type { User } from '../app/lib/auth';

const ON_SITE_CLOSE_HHMM = '22:00';
const REMOTE_MAX_SHIFT_MS = 12 * 60 * 60 * 1000;
const PT_ZONE = 'America/Los_Angeles';
export const REPAIR_DEFAULT_START_DATE = '2026-08-10';
const REPAIR_REASON =
  'Admin one-time repair: retroactive cap of runaway shift per guardrail policy.';

/** Today's date (YYYY-MM-DD) in the admin's local zone — default window end. */
export function repairDefaultEndDate(): string {
  return new Date().toLocaleDateString('en-CA');
}

export interface RepairPreview {
  entryId: string;
  userId: string;
  userName: string;
  workModel: string;
  timezone: string;
  /** Human-readable cap descriptions, one per repaired segment. */
  caps: string[];
  clockInSystem: number;
  totalWorkMinutes: number;
  /** True when the entry was already dayComplete before the repair. */
  wasComplete: boolean;
}

export interface RepairRunawayResult {
  dryRun: boolean;
  window: { startDate: string; endDate: string };
  scanned: number;
  repaired: number;
  repairs: RepairPreview[];
  skipped: { voided: number; noUser: number; noViolation: number };
}

function toMillis(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number') return value;
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return undefined;
}

/** Epoch ms of a wall-clock instant (YYYY-MM-DD + HH:MM) in the given zone. */
function localWallClockToMs(localDate: string, hhmm: string, timeZone: string): number {
  const [y, m, d] = localDate.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const naiveUTC = Date.UTC(y, m - 1, d, hh, mm, 0);
  // Same UTC-anchor-minus-offset iteration as midnightSplit.nextLocalMidnightMs.
  let x = naiveUTC - getTimeZoneOffsetMs(timeZone, naiveUTC);
  x = naiveUTC - getTimeZoneOffsetMs(timeZone, x);
  return x;
}

/** Cap instant (epoch ms) for a segment starting at `clockInMs` under the guardrail policy. */
function computeCapMs(workModel: 'On-site' | 'Remote', clockInMs: number, timezone: string): number {
  if (workModel === 'Remote') return clockInMs + REMOTE_MAX_SHIFT_MS;
  const clockInDate = localDateOf(clockInMs, timezone);
  let cap = localWallClockToMs(clockInDate, ON_SITE_CLOSE_HHMM, timezone);
  if (cap <= clockInMs) {
    // Clocked in after 10 PM — cap at the NEXT local day's 10 PM.
    const nextDate = localDateOf(nextLocalMidnightMs(clockInMs, timezone), timezone);
    cap = localWallClockToMs(nextDate, ON_SITE_CLOSE_HHMM, timezone);
  }
  return cap;
}

interface SegmentPatch {
  id?: string;
  clockOutManual: string;
  clockOutSystem: number;
  clockOutSystemTime: Timestamp;
  lunchOutManual?: string | null;
  lunchOutSystem?: number | null;
  lunchOutSystemTime?: Timestamp | null;
  lunchInManual?: string | null;
  lunchInSystem?: number | null;
  lunchInSystemTime?: Timestamp | null;
  complete: true;
  autoClosed: true;
  flagged: true;
}

/**
 * Build the close-at-cap patch for one segment (open OR completed-but-runaway).
 * Lunch is clamped to the cap: a lunch starting at/after the cap is removed;
 * a lunch straddling the cap ends at the cap.
 */
function buildSegmentCapPatch(seg: Record<string, any>, capMs: number, timezone: string): SegmentPatch { // eslint-disable-line @typescript-eslint/no-explicit-any
  const capManual = localTimeHHMM(capMs, timezone);
  const patch: SegmentPatch = {
    id: typeof seg.id === 'string' ? seg.id : undefined,
    clockOutManual: capManual,
    clockOutSystem: capMs,
    clockOutSystemTime: Timestamp.fromMillis(capMs),
    complete: true,
    autoClosed: true,
    flagged: true,
  };

  const lo = toMillis(seg.lunchOutSystem ?? seg.lunchOutSystemTime);
  const li = toMillis(seg.lunchInSystem ?? seg.lunchInSystemTime);
  const skipLunch = seg.skipLunch === true || seg.lunchSkipped === true;
  if (!skipLunch && typeof lo === 'number') {
    if (lo >= capMs) {
      // Lunch began at/after the cap — it never happened within the capped span.
      patch.lunchOutManual = null;
      patch.lunchOutSystem = null;
      patch.lunchOutSystemTime = null;
      patch.lunchInManual = null;
      patch.lunchInSystem = null;
      patch.lunchInSystemTime = null;
    } else if (typeof li !== 'number' || li > capMs) {
      // Lunch straddles (or is open past) the cap — end it at the cap.
      patch.lunchInManual = capManual;
      patch.lunchInSystem = capMs;
      patch.lunchInSystemTime = Timestamp.fromMillis(capMs);
    }
  }
  return patch;
}

/**
 * Scan the window for runaway entries (open OR completed) and optionally
 * repair them. `dryRun: true` returns the preview list without writing.
 * Window defaults: 2026-08-10 through today (admin-local).
 */
export async function repairRunawayShifts(opts: {
  admin: User;
  usersById: Map<string, User>;
  startDate?: string;
  endDate?: string;
  dryRun?: boolean;
}): Promise<RepairRunawayResult> {
  const { admin, usersById } = opts;
  const startDate = opts.startDate || REPAIR_DEFAULT_START_DATE;
  const endDate = opts.endDate || repairDefaultEndDate();
  const dryRun = opts.dryRun === true;

  // PT-bounded window: clock-ins from 00:00 PT on startDate through end of endDate PT.
  const windowStartMs = localWallClockToMs(startDate, '00:00', PT_ZONE);
  const dayAfterEnd = localDateOf(nextLocalMidnightMs(localWallClockToMs(endDate, '12:00', PT_ZONE), PT_ZONE), PT_ZONE);
  const windowEndMs = localWallClockToMs(dayAfterEnd, '00:00', PT_ZONE);

  const snap = await getDocs(
    query(
      collection(db, 'timeEntries'),
      where('clockInSystem', '>=', windowStartMs),
      where('clockInSystem', '<', windowEndMs),
    ),
  );

  const nowMs = Date.now();
  const repairs: RepairPreview[] = [];
  const skipped = { voided: 0, noUser: 0, noViolation: 0 };

  for (const docSnap of snap.docs) {
    const entryId = docSnap.id;
    const d = docSnap.data() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    if (d.status === 'voided' || d.status === 'archived') { skipped.voided++; continue; }

    const user = usersById.get(String(d.userId || ''));
    if (!user) { skipped.noUser++; continue; }

    const workModel: 'On-site' | 'Remote' = user.workModel === 'Remote' ? 'Remote' : 'On-site';
    const timezone = user.timezone && user.timezone.trim() ? user.timezone : PT_ZONE;

    const segments: Record<string, any>[] = Array.isArray(d.segments) ? d.segments : []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const isFlatDoc = segments.length === 0;

    // Evaluate every segment (or the flat top-level punch): a violation is a
    // segment whose (actual or, for open segments, current) end exceeds its
    // policy cap. Completed entries are inspected too — a "completed" 24-hour
    // runaway is still a runaway.
    const segmentPatches: SegmentPatch[] = [];
    const caps: string[] = [];
    let flatPatch: SegmentPatch | null = null;
    let flatClockInMs: number | undefined;

    if (isFlatDoc) {
      if (!d.clockInManual) { skipped.noViolation++; continue; }
      const inMs = toMillis(d.clockInSystem ?? d.clockInSystemTime);
      if (typeof inMs !== 'number') { skipped.noViolation++; continue; }
      const outMs = toMillis(d.clockOutSystem ?? d.clockOutSystemTime);
      const isOpen = !d.clockOutManual && d.dayComplete !== true;
      if (!isOpen && typeof outMs !== 'number') { skipped.noViolation++; continue; }
      const capMs = computeCapMs(workModel, inMs, timezone);
      const violates = isOpen ? nowMs > capMs : (outMs as number) > capMs;
      if (!violates) { skipped.noViolation++; continue; }
      flatClockInMs = inMs;
      flatPatch = buildSegmentCapPatch(
        {
          clockInSystem: inMs,
          lunchOutSystem: toMillis(d.lunchOutSystem ?? d.lunchOutSystemTime),
          lunchInSystem: toMillis(d.lunchInSystem ?? d.lunchInSystemTime),
          skipLunch: d.skipLunch === true || d.lunchSkipped === true,
        },
        capMs,
        timezone,
      );
      caps.push(`${localDateOf(capMs, timezone)} ${localTimeHHMM(capMs, timezone)} ${timezone}`);
    } else {
      for (const s of segments) {
        const inMs = toMillis(s.clockInSystem ?? s.clockInSystemTime);
        if (typeof inMs !== 'number') continue;
        const outMs = toMillis(s.clockOutSystem ?? s.clockOutSystemTime);
        const isOpen = s.complete !== true && typeof outMs !== 'number';
        if (!isOpen && typeof outMs !== 'number') continue; // unusable segment
        const capMs = computeCapMs(workModel, inMs, timezone);
        const violates = isOpen ? nowMs > capMs : (outMs as number) > capMs;
        if (!violates) continue;
        segmentPatches.push(buildSegmentCapPatch(s, capMs, timezone));
        caps.push(`${localDateOf(capMs, timezone)} ${localTimeHHMM(capMs, timezone)} ${timezone}`);
      }
      if (!segmentPatches.length) { skipped.noViolation++; continue; }
    }

    // Build patched segments / patched flat fields, then recompute the day
    // total via the canonical read-side SSOT (getEntryTotals) so
    // History/Team/Payroll all agree.
    let newSegments: Record<string, any>[] | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    let patchedForTotals: Partial<TimeEntry>;
    if (!isFlatDoc) {
      newSegments = segments.map((s) => {
        const p = segmentPatches.find((x) => x.id === s.id);
        return p ? { ...s, ...p } : s;
      });
      patchedForTotals = {
        ...(d as Partial<TimeEntry>),
        segments: newSegments as TimeEntry['segments'],
        currentSegment: undefined,
        complete: true,
      };
    } else {
      patchedForTotals = {
        ...(d as Partial<TimeEntry>),
        ...flatPatch,
        currentSegment: undefined,
        segments: undefined,
        complete: true,
        // Drop any stale stored total so getEntryTotals derives from the
        // (now-closed) manual punch span instead of returning it.
        totalWorkMinutes: undefined,
      };
    }
    const { totalWorkMinutes } = getEntryTotals(patchedForTotals);

    const firstInMs = isFlatDoc
      ? (flatClockInMs as number)
      : (toMillis(segments[0].clockInSystem ?? segments[0].clockInSystemTime) as number);

    repairs.push({
      entryId,
      userId: String(d.userId || ''),
      userName: user.name,
      workModel,
      timezone,
      caps,
      clockInSystem: firstInMs,
      totalWorkMinutes,
      wasComplete: d.dayComplete === true || d.complete === true,
    });

    if (dryRun) continue;

    const patch: Record<string, unknown> = {
      complete: true,
      dayComplete: true,
      currentStep: 4,
      autoClosed: true,
      flagged: true,
      totalWorkMinutes,
      totalHours: totalWorkMinutes / 60,
      updatedAt: serverTimestamp(),
      updatedBy: admin.uid,
    };
    if (newSegments) {
      patch.segments = newSegments;
      // Keep the dual-written top-level punch fields mirroring the LAST
      // segment when that segment was the one capped.
      const lastSeg = newSegments[newSegments.length - 1];
      const lastPatch = segmentPatches.find((x) => x.id === lastSeg?.id);
      if (lastPatch) {
        patch.clockOutManual = lastPatch.clockOutManual;
        patch.clockOutSystem = lastPatch.clockOutSystem;
        patch.clockOutSystemTime = lastPatch.clockOutSystemTime;
        patch.completedAt = lastPatch.clockOutSystemTime;
        for (const k of ['lunchOutManual', 'lunchOutSystem', 'lunchOutSystemTime', 'lunchInManual', 'lunchInSystem', 'lunchInSystemTime'] as const) {
          if (lastPatch[k] !== undefined) patch[k] = lastPatch[k];
        }
      } else if (lastSeg?.clockOutSystem) {
        patch.completedAt = Timestamp.fromMillis(lastSeg.clockOutSystem);
      }
    } else if (flatPatch) {
      const flatFields: Record<string, unknown> = { ...flatPatch };
      delete flatFields.id;
      Object.assign(patch, flatFields);
      patch.completedAt = flatPatch.clockOutSystemTime;
    }

    await updateDoc(doc(db, 'timeEntries', entryId), patch);
    // Mandatory immutable audit row (audit-mandatory-reason rule).
    await auditLogService.logTimeCorrection({
      actorUid: admin.uid,
      actorName: admin.name,
      actorRole: 'admin',
      targetId: entryId,
      before: {
        clockInSystem: firstInMs,
        clockOutSystem: toMillis(d.clockOutSystem ?? d.clockOutSystemTime) ?? null,
        dayComplete: d.dayComplete ?? null,
        totalWorkMinutes: d.totalWorkMinutes ?? null,
      },
      after: {
        cappedSegments: caps,
        dayComplete: true,
        totalWorkMinutes,
        autoClosed: true,
        flagged: true,
      },
      reason: `${REPAIR_REASON} (${workModel}, ${caps.length} segment(s) capped: ${caps.join('; ')}.)`,
    });
  }

  return {
    dryRun,
    window: { startDate, endDate },
    scanned: snap.size,
    repaired: dryRun ? 0 : repairs.length,
    repairs,
    skipped,
  };
}
