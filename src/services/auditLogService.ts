import { collection, addDoc, query, where, orderBy, getDocs, Timestamp, limit } from 'firebase/firestore';
import { db } from '../app/lib/firebase';

export interface AuditLogEntry {
  id?: string;
  occurredAt: Timestamp;
  actorUid: string;
  actorName?: string;
  actorRole: 'admin' | 'manager' | 'system';
  action: 'time_correction' | 'void_entry' | 'bulk_correction' | 'status_change';
  targetCollection: 'timeEntries';
  targetId: string; // timeEntries doc id (e.g., uid_YYYY-MM-DD)

  // Immutable before/after snapshots (critical for legal defensibility)
  before: Record<string, any>;
  after: Record<string, any>;

  reason: string; // MUST be non-empty human-entered string

  // Optional provenance
  correctionRequestId?: string;
  ip?: string;
  userAgent?: string;
  policyVersion?: string;
}

/**
 * Admin-owned service for writing immutable audit trail entries.
 * PHASE 1: Used exclusively for time corrections.
 * Follows schema in FIRESTORE_DATA_MODEL.md and SECURITY_RULES_PLAN.md.
 * Never updates or deletes audit rows (append-only).
 */
export class AuditLogService {
  private readonly collectionName = 'auditLogs';

  /**
   * Write a single immutable audit log entry for a time correction.
   * REQUIRES non-empty reason (enforced here + UI + future rules).
   * Throws on empty/whitespace reason or failed write.
   */
  async logTimeCorrection(params: {
    actorUid: string;
    actorName?: string;
    targetId: string;
    before: Record<string, any>;
    after: Record<string, any>;
    reason: string;
    correctionRequestId?: string;
  }): Promise<string> {
    const trimmedReason = (params.reason || '').trim();

    if (!trimmedReason) {
      throw new Error('Audit log rejected: reason is required and must be non-empty');
    }

    const entry: Omit<AuditLogEntry, 'id'> = {
      occurredAt: Timestamp.now(),
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: 'admin',
      action: 'time_correction',
      targetCollection: 'timeEntries',
      targetId: params.targetId,
      before: params.before,
      after: params.after,
      reason: trimmedReason,
      correctionRequestId: params.correctionRequestId,
    };

    try {
      const docRef = await addDoc(collection(db, this.collectionName), entry);
      return docRef.id;
    } catch (err) {
      console.error('[AuditLogService] Failed to write audit log:', err);
      throw new Error('Failed to record immutable audit trail. Correction aborted for safety.');
    }
  }

  async logVoidEntry(params: {
    actorUid: string;
    actorName?: string;
    actorRole: 'admin' | 'manager' | 'system';
    targetId: string;
    before: Record<string, any>;
    reason: string;
  }): Promise<string> {
    const trimmedReason = (params.reason || '').trim();

    if (!trimmedReason) {
      throw new Error('Audit log rejected: reason is required and must be non-empty');
    }

    const entry: Omit<AuditLogEntry, 'id'> = {
      occurredAt: Timestamp.now(),
      actorUid: params.actorUid,
      actorName: params.actorName,
      actorRole: params.actorRole,
      action: 'void_entry',
      targetCollection: 'timeEntries',
      targetId: params.targetId,
      before: params.before,
      after: { status: 'voided' },
      reason: trimmedReason,
    };

    try {
      const docRef = await addDoc(collection(db, this.collectionName), entry);
      return docRef.id;
    } catch (err) {
      console.error('[AuditLogService] Failed to write void audit log:', err);
      throw new Error('Failed to record immutable audit trail. Void operation aborted for safety.');
    }
  }

  /**
   * Future: Query audit history for a given time entry (admin + manager + employee self).
   */
  async getAuditHistoryForEntry(targetId: string, max: number = 50): Promise<AuditLogEntry[]> {
    const q = query(
      collection(db, this.collectionName),
      where('targetCollection', '==', 'timeEntries'),
      where('targetId', '==', targetId),
      orderBy('occurredAt', 'desc'),
      limit(max)
    );

    const snap = await getDocs(q);
    return snap.docs.map(d => ({
      id: d.id,
      ...d.data(),
    })) as AuditLogEntry[];
  }
}

export const auditLogService = new AuditLogService();
