/**
 * One-time admin repair utility for historical runaway entries.
 *
 * Replaces the former `repairRunawayShifts` Cloud Function: deploying a v1
 * callable requires granting `roles/cloudfunctions.invoker` to allUsers,
 * which the Google Cloud org policy blocks. The Admin Panel already has an
 * authenticated admin path (same as "Correct Entry") — firestore.rules allow
 * admins to update any timeEntry and append auditLogs — so the repair runs
 * client-side under the signed-in admin instead of a public invoker function.
 *
 * Policy (mirrors the server-side autoGuardrails cron):
 *   - On-site: cap the un-split open shift at 10:00 PM local (next local day
 *     when the clock-in itself was after 10 PM).
 *   - Remote: cap the shift at 12 hours from the initial clock-in.
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
const DEFAULT_RANGE = { startDate: '2026-08-10', endDate: '2026-08-17' };
const REPAIR_REASON =
  'Admin one-time repair: retroactive cap of historical runaway shift per guardrail policy.';

export interface RepairPreview {
  entryId: string;
  userId: string;
  userName: string;
  workModel: string;
  timezone: string;
  clockInSystem: number;
  capAtSystem: number;
  capAtLocal: string;
  totalWorkMinutes: number;
}

export interface RepairRunawayResult {
  dryRun: boolean;
  window: { startDate: string; endDate: string };
  scanned: number;
  repaired: number;
  repairs: RepairPreview[];
  skipped: { closed: number; voided: number; noSegment: number; noUser: number; withinPolicy: number };
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

/** Cap instant (epoch ms) for a still-open shift under the guardrail policy. */
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

/**
 * Scan the window for still-open (runaway) entries and optionally repair them.
 * `dryRun: true` returns the preview list without writing anything.
 */
export async function repairRunawayShifts(opts: {
  admin: User;
  usersById: Map<string, User>;
  startDate?: string;
  endDate?: string;
  dryRun?: boolean;
}): Promise<RepairRunawayResult> {
  const { admin, usersById } = opts;
  const startDate = opts.startDate || DEFAULT_RANGE.startDate;
  const endDate = opts.endDate || DEFAULT_RANGE.endDate;
  const dryRun = opts.dryRun === true;

  // PT-bounded window: clock-ins from 00:00 PT on startDate through end of endDate PT.
  const windowStartMs = localWallClockToMs(startDate, '00:00', PT_ZONE);
  const nextDay = localDateOf(nextLocalMidnightMs(localWallClockToMs(endDate, '12:00', PT_ZONE), PT_ZONE), PT_ZONE);
  const windowEndMs = localWallClockToMs(nextDay, '00:00', PT_ZONE);

  const snap = await getDocs(
    query(
      collection(db, 'timeEntries'),
      where('clockInSystem', '>=', windowStartMs),
      where('clockInSystem', '<', windowEndMs),
    ),
  );

  const nowMs = Date.now();
  const repairs: RepairPreview[] = [];
  const skipped = { closed: 0, voided: 0, noSegment: 0, noUser: 0, withinPolicy: 0 };

  for (const docSnap of snap.docs) {
    const entryId = docSnap.id;
    const d = docSnap.data() as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

    if (d.status === 'voided' || d.status === 'archived') { skipped.voided++; continue; }
    if (d.dayComplete === true || d.complete === true) { skipped.closed++; continue; }

    const user = usersById.get(String(d.userId || ''));
    if (!user) { skipped.noUser++; continue; }

    const segments: Record<string, any>[] = Array.isArray(d.segments) ? d.segments : []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const openSeg = segments.length ? segments[segments.length - 1] : null;
    const openSegIsOpen = !!openSeg && openSeg.complete !== true;
    // Legacy flat doc (no segments) with a top-level open punch.
    const flatOpen = !segments.length && !!d.clockInManual && !d.clockOutManual;
    if (!openSegIsOpen && !flatOpen) { skipped.noSegment++; continue; }

    const clockInMs = openSegIsOpen
      ? toMillis(openSeg.clockInSystem ?? openSeg.clockInSystemTime)
      : toMillis(d.clockInSystem ?? d.clockInSystemTime);
    if (typeof clockInMs !== 'number') { skipped.noSegment++; continue; }

    const workModel: 'On-site' | 'Remote' = user.workModel === 'Remote' ? 'Remote' : 'On-site';
    const timezone = user.timezone && user.timezone.trim() ? user.timezone : PT_ZONE;

    const capMs = computeCapMs(workModel, clockInMs, timezone);
    if (capMs > nowMs) { skipped.withinPolicy++; continue; } // not actually runaway

    const capManual = localTimeHHMM(capMs, timezone);

    // Build the patched entry, then recompute the day total via the canonical
    // read-side SSOT (getEntryTotals) so History/Team/Payroll all agree.
    let newSegments: Record<string, any>[] | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (openSegIsOpen) {
      newSegments = segments.map((s) =>
        s.id === openSeg!.id
          ? {
              ...s,
              clockOutManual: capManual,
              clockOutSystem: capMs,
              clockOutSystemTime: Timestamp.fromMillis(capMs),
              complete: true,
              autoClosed: true,
              flagged: true,
            }
          : s,
      );
    }
    const patchedForTotals: Partial<TimeEntry> = {
      ...(d as Partial<TimeEntry>),
      segments: (newSegments ?? undefined) as TimeEntry['segments'],
      currentSegment: undefined,
      complete: true,
      clockOutManual: capManual,
      // Flat-doc path: drop any stale stored total so getEntryTotals derives
      // from the (now-closed) manual punch span instead of returning it.
      totalWorkMinutes: openSegIsOpen ? (d.totalWorkMinutes as number | undefined) : undefined,
    };
    const { totalWorkMinutes } = getEntryTotals(patchedForTotals);

    repairs.push({
      entryId,
      userId: String(d.userId || ''),
      userName: user.name,
      workModel,
      timezone,
      clockInSystem: clockInMs,
      capAtSystem: capMs,
      capAtLocal: `${localDateOf(capMs, timezone)} ${capManual} ${timezone}`,
      totalWorkMinutes,
    });

    if (dryRun) continue;

    const patch: Record<string, unknown> = {
      clockOutManual: capManual,
      clockOutSystem: capMs,
      clockOutSystemTime: Timestamp.fromMillis(capMs),
      complete: true,
      dayComplete: true,
      currentStep: 4,
      completedAt: Timestamp.fromMillis(capMs),
      autoClosed: true,
      flagged: true,
      totalWorkMinutes,
      totalHours: totalWorkMinutes / 60,
      updatedAt: serverTimestamp(),
      updatedBy: admin.uid,
    };
    if (newSegments) patch.segments = newSegments;

    await updateDoc(doc(db, 'timeEntries', entryId), patch);
    // Mandatory immutable audit row (audit-mandatory-reason rule).
    await auditLogService.logTimeCorrection({
      actorUid: admin.uid,
      actorName: admin.name,
      actorRole: 'admin',
      targetId: entryId,
      before: {
        clockInSystem: clockInMs,
        clockOutSystem: null,
        dayComplete: d.dayComplete ?? null,
        totalWorkMinutes: d.totalWorkMinutes ?? null,
      },
      after: {
        clockOutManual: capManual,
        clockOutSystem: capMs,
        dayComplete: true,
        totalWorkMinutes,
        autoClosed: true,
        flagged: true,
      },
      reason: `${REPAIR_REASON} (${workModel}, capped at ${capManual} ${timezone}.)`,
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
