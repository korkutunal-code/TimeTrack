import type { CorrectionRequest } from '../../lib/database';

/**
 * Active-correction-request badge lookup for the Edit / Request Time
 * Adjustments modal.
 *
 * Key format: `${requested_date}|${issue_type}|${shift_id}` for requests that
 * carry a `shift_id` (written by the modal since shift-scoped badging), and
 * `${requested_date}|${issue_type}` for legacy requests that predate the
 * `shift_id` field.
 *
 * The shift-scoped key is what makes a pending badge attach to ONE shift on a
 * multi-shift day: a request submitted for Shift 1 carries Shift 1's segment
 * id, so its key only matches Shift 1's lookup — Shift 2 on the same date
 * (same `${date}|${issueType}` prefix, different segment id) does NOT match.
 *
 * Legacy requests (no `shift_id`) keep the pre-fix date+issue_type behavior:
 * their badge still shows on every shift of that date+field. They age out as
 * admins resolve them, so the bleed is temporary and only affects requests
 * created before the shift-scoping fix.
 */

/** Build the lookup map from active (Open / In Progress) requests. */
export function buildActiveRequestMap(
  requests: Pick<CorrectionRequest, 'requested_date' | 'issue_type' | 'shift_id'>[],
): Map<string, Pick<CorrectionRequest, 'requested_date' | 'issue_type' | 'shift_id'>> {
  const m = new Map<string, Pick<CorrectionRequest, 'requested_date' | 'issue_type' | 'shift_id'>>();
  for (const r of requests) {
    if (r.shift_id) {
      m.set(`${r.requested_date}|${r.issue_type}|${r.shift_id}`, r);
    } else {
      // Legacy fallback: no shift_id recorded — key by date+issue_type only.
      m.set(`${r.requested_date}|${r.issue_type}`, r);
    }
  }
  return m;
}

/**
 * Look up the active request for a specific shift cell. Tries the
 * shift-scoped key first; falls back to the legacy date+issue_type key so
 * in-flight pre-fix requests still surface a badge.
 */
export function findActiveRequest<
  T extends Pick<CorrectionRequest, 'requested_date' | 'issue_type' | 'shift_id'>,
>(
  map: Map<string, T>,
  date: string,
  issueType: string,
  shiftId: string,
): T | undefined {
  return map.get(`${date}|${issueType}|${shiftId}`) ?? map.get(`${date}|${issueType}`);
}
