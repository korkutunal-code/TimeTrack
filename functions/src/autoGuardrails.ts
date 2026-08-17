import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import moment from 'moment-timezone';

// Initialize admin if not already initialized in index.ts
if (!admin.apps.length) {
    admin.initializeApp();
}

const db = admin.firestore();

const ON_SITE_CLOSE_HHMM = '22:00';
const REMOTE_MAX_SHIFT_MS = 12 * 60 * 60 * 1000;
const LUNCH_AUTO_END_MS = 60 * 60 * 1000;
const DEFAULT_TIMEZONE = 'America/Los_Angeles';

/**
 * Normalize a Firestore Timestamp | number | Date to epoch millis.
 * The client dual-writes both `clockInSystem` (millis) and `clockInSystemTime`
 * (Timestamp), so we accept whichever is present.
 */
function toMillis(value: unknown): number | undefined {
    if (value == null) return undefined;
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'object' && typeof (value as any).toMillis === 'function') {
        return (value as any).toMillis();
    }
    return undefined;
}

/** Minimal view of the currently-open shift segment (mirrors client getActiveSegment). */
interface OpenSegment {
    id?: string;
    clockInSystem?: number;
    lunchOutSystem?: number;
    lunchInSystem?: number;
    skipLunch?: boolean;
}

/** Locate the open (not clocked-out) segment in a raw timeEntries doc. */
function getOpenSegment(data: any): OpenSegment | null {
    if (!data) return null;
    if (data.status === 'voided' || data.status === 'archived') return null;

    const segments = Array.isArray(data.segments) ? data.segments : [];
    if (segments.length) {
        const last = segments[segments.length - 1];
        if (last && last.complete !== true) {
            return {
                id: typeof last.id === 'string' ? last.id : undefined,
                clockInSystem: toMillis(last.clockInSystem ?? last.clockInSystemTime),
                lunchOutSystem: toMillis(last.lunchOutSystem ?? last.lunchOutSystemTime),
                lunchInSystem: toMillis(last.lunchInSystem ?? last.lunchInSystemTime),
                skipLunch: last.skipLunch === true || last.lunchSkipped === true,
            };
        }
    }

    // Legacy flat doc: clocked in at the top level but never clocked out.
    if (data.clockInManual && !data.clockOutManual && data.dayComplete !== true) {
        return {
            clockInSystem: toMillis(data.clockInSystem ?? data.clockInSystemTime),
            lunchOutSystem: toMillis(data.lunchOutSystem ?? data.lunchOutSystemTime),
            lunchInSystem: toMillis(data.lunchInSystem ?? data.lunchInSystemTime),
            skipLunch: data.skipLunch === true || data.lunchSkipped === true,
        };
    }

    return null;
}

/** Work minutes for a closed span from system timestamps, lunch-aware. */
function computeWorkMinutes(openSeg: OpenSegment, closedAtMs: number): number {
    const inSys = openSeg.clockInSystem;
    if (typeof inSys !== 'number') return 0;
    let gross = Math.max(0, Math.round((closedAtMs - inSys) / 60000));
    if (openSeg.skipLunch !== true) {
        const lo = openSeg.lunchOutSystem;
        const li = openSeg.lunchInSystem;
        if (typeof lo === 'number' && typeof li === 'number' && li >= lo) {
            gross = Math.max(0, gross - Math.round((li - lo) / 60000));
        }
    }
    return gross;
}

/** Append an immutable audit row (actor 'system') for a guardrail action. */
async function writeAuditLog(
    entryId: string,
    reason: string,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
): Promise<void> {
    try {
        await db.collection('auditLogs').add({
            occurredAt: admin.firestore.FieldValue.serverTimestamp(),
            actorUid: 'system',
            actorName: 'System Guardrails',
            actorRole: 'system',
            action: 'time_correction',
            targetCollection: 'timeEntries',
            targetId: entryId,
            before,
            after,
            reason,
        });
    } catch (err) {
        functions.logger.error(`Failed to write guardrail audit log for ${entryId}:`, err);
    }
}

/**
 * Auto-Guardrails Engine — runs every 15 minutes and evaluates all open time
 * entries against the employee's canonical timezone:
 *
 *   - On-site auto-close at 10:00 PM local.
 *   - Remote auto-close at the 12-hour mark.
 *   - 1-hour lunch auto-end.
 *
 * Every action writes `flagged: true` (+ `autoClosed` / `autoEndedLunch`) and
 * an immutable `auditLogs` row with actor 'system'. Because this runs under the
 * Admin SDK it bypasses Firestore security rules, which is required for the
 * cross-user system write + audit append.
 */
/**
 * Fetch every candidate open-shift doc.
 *
 * Query audit (2026-08-18):
 *  - `dayComplete == false` matches shifts created today AND shifts that
 *    crossed a local midnight while still open: the midnight-split path in
 *    clockService keeps the open segment on the ORIGINAL `${uid}_${date}` doc
 *    (day-2+ docs are only written, already closed, at punch-out), so an open
 *    split shift still carries `dayComplete: false` and is matched here.
 *  - GAP: Firestore `== false` does NOT match docs where `dayComplete` is
 *    missing entirely (legacy rows written before the field existed). Those
 *    are fetched by a second, time-bounded query and merged in.
 */
async function fetchOpenEntryCandidates(nowMs: number): Promise<admin.firestore.QueryDocumentSnapshot[]> {
    const byId = new Map<string, admin.firestore.QueryDocumentSnapshot>();

    const primarySnap = await db.collection('timeEntries')
        .where('dayComplete', '==', false)
        .limit(1000)
        .get();
    for (const d of primarySnap.docs) byId.set(d.id, d);

    // Legacy fallback: docs with NO `dayComplete` field. Bounded to shifts
    // started in the last 7 days (a still-open shift older than that is a
    // historical runaway — handled by repairRunawayShifts, not the cron).
    const legacyCutoffMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const legacySnap = await db.collection('timeEntries')
        .where('clockInSystem', '>', legacyCutoffMs)
        .limit(1000)
        .get();
    for (const d of legacySnap.docs) {
        if (byId.has(d.id)) continue;
        const data = d.data() as any;
        if (data.dayComplete !== undefined) continue; // has the field — primary query owns it
        byId.set(d.id, d);
    }

    return Array.from(byId.values());
}

export const runAutoGuardrails = functions.pubsub
    .schedule('every 15 minutes')
    .onRun(async () => {
        functions.logger.info('Starting auto-guardrails evaluation...');
        try {
            const usersSnap = await db.collection('users').where('active', '==', true).get();
            const usersById = new Map<string, any>();
            for (const u of usersSnap.docs) usersById.set(u.id, u.data());

            const nowMs = Date.now();
            const candidates = await fetchOpenEntryCandidates(nowMs);
            functions.logger.info(`Auto-guardrails: query returned ${candidates.length} candidate open-entr${candidates.length === 1 ? 'y' : 'ies'}.`);

            for (const docSnap of candidates) {
                const entryId = docSnap.id;
                const data = docSnap.data() as any;
                const userData = usersById.get(String(data.userId || ''));
                if (!userData) {
                    functions.logger.info(`Auto-guardrails: skipping ${entryId} — orphaned entry (no active user ${data.userId}).`);
                    continue;
                }

                const openSeg = getOpenSegment(data);
                if (!openSeg || typeof openSeg.clockInSystem !== 'number') {
                    functions.logger.info(`Auto-guardrails: skipping ${entryId} — no open segment with a system clock-in.`);
                    continue;
                }

                const workModel = userData.workModel === 'Remote' ? 'Remote' : 'On-site';
                const timezone =
                    typeof userData.timezone === 'string' && userData.timezone.trim()
                        ? userData.timezone
                        : DEFAULT_TIMEZONE;
                const elapsedHours = (nowMs - openSeg.clockInSystem) / 3600000;
                functions.logger.info(
                    `Auto-guardrails: evaluating entry=${entryId} user=${data.userId} ` +
                    `workModel=${workModel} timezone=${timezone} elapsedHours=${elapsedHours.toFixed(2)}`,
                );

                // --- 1) Shift auto-close (takes precedence over lunch auto-end) ----
                let closedAtMs: number | null = null;
                let closeReason = '';

                if (workModel === 'Remote') {
                    const candidate = openSeg.clockInSystem + REMOTE_MAX_SHIFT_MS;
                    if (nowMs >= candidate) {
                        closedAtMs = candidate;
                        closeReason = 'Remote shift reached the 12-hour limit';
                    }
                } else {
                    const clockInDate = moment.tz(openSeg.clockInSystem, timezone).format('YYYY-MM-DD');
                    let candidate = moment.tz(`${clockInDate} ${ON_SITE_CLOSE_HHMM}`, 'YYYY-MM-DD HH:mm', timezone).valueOf();
                    if (candidate <= openSeg.clockInSystem) {
                        // Clocked in after 10 PM — close at the next day's 10 PM.
                        const nextDate = moment.tz(openSeg.clockInSystem + 86400000, timezone).format('YYYY-MM-DD');
                        candidate = moment.tz(`${nextDate} ${ON_SITE_CLOSE_HHMM}`, 'YYYY-MM-DD HH:mm', timezone).valueOf();
                    }
                    if (nowMs >= candidate) {
                        closedAtMs = candidate;
                        closeReason = 'On-site shift reached 10:00 PM local time';
                    }
                }

                if (closedAtMs !== null) {
                    // TS: `let` narrowing is discarded inside the segments.map
                    // closure below — bind a const for use inside callbacks.
                    const capMs: number = closedAtMs;
                    const closeManual = moment.tz(closedAtMs, timezone).format('HH:mm');
                    // Close any in-progress lunch at the close instant so it is deducted.
                    const onLunch =
                        typeof openSeg.lunchOutSystem === 'number' &&
                        typeof openSeg.lunchInSystem !== 'number' &&
                        openSeg.skipLunch !== true;
                    const effectiveLunchIn = onLunch ? closedAtMs : openSeg.lunchInSystem;
                    const workMinutes = computeWorkMinutes(
                        { ...openSeg, lunchInSystem: effectiveLunchIn },
                        closedAtMs,
                    );

                    const before: Record<string, unknown> = {
                        clockInSystem: openSeg.clockInSystem,
                        lunchOutSystem: openSeg.lunchOutSystem ?? null,
                        lunchInSystem: openSeg.lunchInSystem ?? null,
                        clockOutSystem: null,
                    };

                    const patch: Record<string, unknown> = {
                        clockOutManual: closeManual,
                        clockOutSystem: closedAtMs,
                        clockOutSystemTime: admin.firestore.Timestamp.fromMillis(closedAtMs),
                        complete: true,
                        dayComplete: true,
                        currentStep: 4,
                        completedAt: admin.firestore.Timestamp.fromMillis(closedAtMs),
                        autoClosed: true,
                        flagged: true,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        updatedBy: 'system',
                    };
                    if (onLunch) {
                        patch.lunchInManual = closeManual;
                        patch.lunchInSystem = closedAtMs;
                        patch.lunchInSystemTime = admin.firestore.Timestamp.fromMillis(closedAtMs);
                    }

                    // Close the matching open segment in segments[] too.
                    if (openSeg.id && Array.isArray(data.segments)) {
                        const newSegments = (data.segments as any[]).map((s: any) => {
                            if (s.id === openSeg.id) {
                                const closed: any = {
                                    ...s,
                                    clockOutManual: closeManual,
                                    clockOutSystem: capMs,
                                    clockOutSystemTime: admin.firestore.Timestamp.fromMillis(capMs),
                                    workMinutes,
                                    complete: true,
                                    autoClosed: true,
                                    flagged: true,
                                };
                                if (onLunch) {
                                    closed.lunchInManual = closeManual;
                                    closed.lunchInSystem = capMs;
                                    closed.lunchInSystemTime = admin.firestore.Timestamp.fromMillis(capMs);
                                }
                                return closed;
                            }
                            return s;
                        });
                        patch.segments = newSegments;
                        patch.totalWorkMinutes = newSegments.reduce(
                            (sum: number, s: any) => sum + (typeof s.workMinutes === 'number' ? s.workMinutes : 0),
                            0,
                        );
                    } else {
                        patch.totalWorkMinutes = workMinutes;
                    }

                    await docSnap.ref.update(patch);
                    await writeAuditLog(
                        entryId,
                        `System auto-closed shift: ${closeReason}.`,
                        before,
                        {
                            clockOutManual: closeManual,
                            clockOutSystem: closedAtMs,
                            autoClosed: true,
                            flagged: true,
                        },
                    );
                    functions.logger.info(`Auto-closed shift ${entryId} (${closeReason})`);
                    continue;
                }

                // --- 2) Lunch auto-end (1 hour) -------------------------------------
                const lo = openSeg.lunchOutSystem;
                const li = openSeg.lunchInSystem;
                if (typeof lo === 'number' && typeof li !== 'number' && openSeg.skipLunch !== true) {
                    const endAtMs = lo + LUNCH_AUTO_END_MS;
                    if (nowMs >= endAtMs) {
                        const lunchInManual = moment.tz(endAtMs, timezone).format('HH:mm');
                        const patch: Record<string, unknown> = {
                            lunchInManual,
                            lunchInSystem: endAtMs,
                            lunchInSystemTime: admin.firestore.Timestamp.fromMillis(endAtMs),
                            autoEndedLunch: true,
                            flagged: true,
                            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                            updatedBy: 'system',
                        };
                        if (openSeg.id && Array.isArray(data.segments)) {
                            patch.segments = (data.segments as any[]).map((s: any) => {
                                if (s.id === openSeg.id) {
                                    return {
                                        ...s,
                                        lunchInManual,
                                        lunchInSystem: endAtMs,
                                        lunchInSystemTime: admin.firestore.Timestamp.fromMillis(endAtMs),
                                        autoEndedLunch: true,
                                        flagged: true,
                                    };
                                }
                                return s;
                            });
                        }
                        await docSnap.ref.update(patch);
                        await writeAuditLog(
                            entryId,
                            'System auto-ended lunch after 60 minutes.',
                            { lunchOutSystem: lo, lunchInSystem: null },
                            {
                                lunchInManual,
                                lunchInSystem: endAtMs,
                                autoEndedLunch: true,
                                flagged: true,
                            },
                        );
                        functions.logger.info(`Auto-ended lunch for ${entryId}`);
                    }
                }
            }
        } catch (error) {
            functions.logger.error('Error in runAutoGuardrails cron job:', error);
        }

        return null;
    });
