"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAutoGuardrails = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const moment_timezone_1 = __importDefault(require("moment-timezone"));
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
function toMillis(value) {
    if (value == null)
        return undefined;
    if (typeof value === 'number')
        return value;
    if (value instanceof Date)
        return value.getTime();
    if (typeof value === 'object' && typeof value.toMillis === 'function') {
        return value.toMillis();
    }
    return undefined;
}
/** Locate the open (not clocked-out) segment in a raw timeEntries doc. */
function getOpenSegment(data) {
    var _a, _b, _c, _d, _e, _f;
    if (!data)
        return null;
    if (data.status === 'voided' || data.status === 'archived')
        return null;
    const segments = Array.isArray(data.segments) ? data.segments : [];
    if (segments.length) {
        const last = segments[segments.length - 1];
        if (last && last.complete !== true) {
            return {
                id: typeof last.id === 'string' ? last.id : undefined,
                clockInSystem: toMillis((_a = last.clockInSystem) !== null && _a !== void 0 ? _a : last.clockInSystemTime),
                lunchOutSystem: toMillis((_b = last.lunchOutSystem) !== null && _b !== void 0 ? _b : last.lunchOutSystemTime),
                lunchInSystem: toMillis((_c = last.lunchInSystem) !== null && _c !== void 0 ? _c : last.lunchInSystemTime),
                skipLunch: last.skipLunch === true || last.lunchSkipped === true,
            };
        }
    }
    // Legacy flat doc: clocked in at the top level but never clocked out.
    if (data.clockInManual && !data.clockOutManual && data.dayComplete !== true) {
        return {
            clockInSystem: toMillis((_d = data.clockInSystem) !== null && _d !== void 0 ? _d : data.clockInSystemTime),
            lunchOutSystem: toMillis((_e = data.lunchOutSystem) !== null && _e !== void 0 ? _e : data.lunchOutSystemTime),
            lunchInSystem: toMillis((_f = data.lunchInSystem) !== null && _f !== void 0 ? _f : data.lunchInSystemTime),
            skipLunch: data.skipLunch === true || data.lunchSkipped === true,
        };
    }
    return null;
}
/** Work minutes for a closed span from system timestamps, lunch-aware. */
function computeWorkMinutes(openSeg, closedAtMs) {
    const inSys = openSeg.clockInSystem;
    if (typeof inSys !== 'number')
        return 0;
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
async function writeAuditLog(entryId, reason, before, after) {
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
    }
    catch (err) {
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
async function fetchOpenEntryCandidates(nowMs) {
    const byId = new Map();
    const primarySnap = await db.collection('timeEntries')
        .where('dayComplete', '==', false)
        .limit(1000)
        .get();
    for (const d of primarySnap.docs)
        byId.set(d.id, d);
    // Legacy fallback: docs with NO `dayComplete` field. Bounded to shifts
    // started in the last 7 days (a still-open shift older than that is a
    // historical runaway — handled by repairRunawayShifts, not the cron).
    const legacyCutoffMs = nowMs - 7 * 24 * 60 * 60 * 1000;
    const legacySnap = await db.collection('timeEntries')
        .where('clockInSystem', '>', legacyCutoffMs)
        .limit(1000)
        .get();
    for (const d of legacySnap.docs) {
        if (byId.has(d.id))
            continue;
        const data = d.data();
        if (data.dayComplete !== undefined)
            continue; // has the field — primary query owns it
        byId.set(d.id, d);
    }
    return Array.from(byId.values());
}
exports.runAutoGuardrails = functions.pubsub
    .schedule('every 15 minutes')
    .onRun(async () => {
    var _a, _b;
    functions.logger.info('Starting auto-guardrails evaluation...');
    try {
        const usersSnap = await db.collection('users').where('active', '==', true).get();
        const usersById = new Map();
        for (const u of usersSnap.docs)
            usersById.set(u.id, u.data());
        const nowMs = Date.now();
        const candidates = await fetchOpenEntryCandidates(nowMs);
        functions.logger.info(`Auto-guardrails: query returned ${candidates.length} candidate open-entr${candidates.length === 1 ? 'y' : 'ies'}.`);
        for (const docSnap of candidates) {
            const entryId = docSnap.id;
            const data = docSnap.data();
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
            const timezone = typeof userData.timezone === 'string' && userData.timezone.trim()
                ? userData.timezone
                : DEFAULT_TIMEZONE;
            const elapsedHours = (nowMs - openSeg.clockInSystem) / 3600000;
            functions.logger.info(`Auto-guardrails: evaluating entry=${entryId} user=${data.userId} ` +
                `workModel=${workModel} timezone=${timezone} elapsedHours=${elapsedHours.toFixed(2)}`);
            // --- 1) Shift auto-close (takes precedence over lunch auto-end) ----
            let closedAtMs = null;
            let closeReason = '';
            if (workModel === 'Remote') {
                const candidate = openSeg.clockInSystem + REMOTE_MAX_SHIFT_MS;
                if (nowMs >= candidate) {
                    closedAtMs = candidate;
                    closeReason = 'Remote shift reached the 12-hour limit';
                }
            }
            else {
                const clockInDate = moment_timezone_1.default.tz(openSeg.clockInSystem, timezone).format('YYYY-MM-DD');
                let candidate = moment_timezone_1.default.tz(`${clockInDate} ${ON_SITE_CLOSE_HHMM}`, 'YYYY-MM-DD HH:mm', timezone).valueOf();
                if (candidate <= openSeg.clockInSystem) {
                    // Clocked in after 10 PM — close at the next day's 10 PM.
                    const nextDate = moment_timezone_1.default.tz(openSeg.clockInSystem + 86400000, timezone).format('YYYY-MM-DD');
                    candidate = moment_timezone_1.default.tz(`${nextDate} ${ON_SITE_CLOSE_HHMM}`, 'YYYY-MM-DD HH:mm', timezone).valueOf();
                }
                if (nowMs >= candidate) {
                    closedAtMs = candidate;
                    closeReason = 'On-site shift reached 10:00 PM local time';
                }
            }
            if (closedAtMs !== null) {
                // TS: `let` narrowing is discarded inside the segments.map
                // closure below — bind a const for use inside callbacks.
                const capMs = closedAtMs;
                const closeManual = moment_timezone_1.default.tz(closedAtMs, timezone).format('HH:mm');
                // Close any in-progress lunch at the close instant so it is deducted.
                const onLunch = typeof openSeg.lunchOutSystem === 'number' &&
                    typeof openSeg.lunchInSystem !== 'number' &&
                    openSeg.skipLunch !== true;
                const effectiveLunchIn = onLunch ? closedAtMs : openSeg.lunchInSystem;
                const workMinutes = computeWorkMinutes(Object.assign(Object.assign({}, openSeg), { lunchInSystem: effectiveLunchIn }), closedAtMs);
                const before = {
                    clockInSystem: openSeg.clockInSystem,
                    lunchOutSystem: (_a = openSeg.lunchOutSystem) !== null && _a !== void 0 ? _a : null,
                    lunchInSystem: (_b = openSeg.lunchInSystem) !== null && _b !== void 0 ? _b : null,
                    clockOutSystem: null,
                };
                const patch = {
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
                    const newSegments = data.segments.map((s) => {
                        if (s.id === openSeg.id) {
                            const closed = Object.assign(Object.assign({}, s), { clockOutManual: closeManual, clockOutSystem: capMs, clockOutSystemTime: admin.firestore.Timestamp.fromMillis(capMs), workMinutes, complete: true, autoClosed: true, flagged: true });
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
                    patch.totalWorkMinutes = newSegments.reduce((sum, s) => sum + (typeof s.workMinutes === 'number' ? s.workMinutes : 0), 0);
                }
                else {
                    patch.totalWorkMinutes = workMinutes;
                }
                await docSnap.ref.update(patch);
                await writeAuditLog(entryId, `System auto-closed shift: ${closeReason}.`, before, {
                    clockOutManual: closeManual,
                    clockOutSystem: closedAtMs,
                    autoClosed: true,
                    flagged: true,
                });
                functions.logger.info(`Auto-closed shift ${entryId} (${closeReason})`);
                continue;
            }
            // --- 2) Lunch auto-end (1 hour) -------------------------------------
            const lo = openSeg.lunchOutSystem;
            const li = openSeg.lunchInSystem;
            if (typeof lo === 'number' && typeof li !== 'number' && openSeg.skipLunch !== true) {
                const endAtMs = lo + LUNCH_AUTO_END_MS;
                if (nowMs >= endAtMs) {
                    const lunchInManual = moment_timezone_1.default.tz(endAtMs, timezone).format('HH:mm');
                    const patch = {
                        lunchInManual,
                        lunchInSystem: endAtMs,
                        lunchInSystemTime: admin.firestore.Timestamp.fromMillis(endAtMs),
                        autoEndedLunch: true,
                        flagged: true,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                        updatedBy: 'system',
                    };
                    if (openSeg.id && Array.isArray(data.segments)) {
                        patch.segments = data.segments.map((s) => {
                            if (s.id === openSeg.id) {
                                return Object.assign(Object.assign({}, s), { lunchInManual, lunchInSystem: endAtMs, lunchInSystemTime: admin.firestore.Timestamp.fromMillis(endAtMs), autoEndedLunch: true, flagged: true });
                            }
                            return s;
                        });
                    }
                    await docSnap.ref.update(patch);
                    await writeAuditLog(entryId, 'System auto-ended lunch after 60 minutes.', { lunchOutSystem: lo, lunchInSystem: null }, {
                        lunchInManual,
                        lunchInSystem: endAtMs,
                        autoEndedLunch: true,
                        flagged: true,
                    });
                    functions.logger.info(`Auto-ended lunch for ${entryId}`);
                }
            }
        }
    }
    catch (error) {
        functions.logger.error('Error in runAutoGuardrails cron job:', error);
    }
    return null;
});
//# sourceMappingURL=autoGuardrails.js.map