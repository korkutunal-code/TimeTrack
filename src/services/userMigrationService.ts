/**
 * One-time backfill: ensure every users/{uid} document physically contains
 * `remotePayCalculationDay: 1` as a native Firestore number.
 *
 * Triggered once on admin init (AdminPanel mount). Only admins may run it:
 * firestore.rules gates `users` updates to `hasRole('admin')` or a narrow
 * self-service key set that does not include this field.
 *
 * Idempotent by construction: docs that already hold a numeric
 * `remotePayCalculationDay` are skipped, so repeat runs are read-only no-ops.
 * Docs holding a non-numeric value are rewritten so the console always shows
 * a number (satisfies the Stage-1 verification criterion).
 */
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../app/lib/firebase';
import { listWorkModels } from './workModelsService';
import { isRemoteWorkModel } from '../utils/workModelUtils';

export const DEFAULT_REMOTE_PAY_CALCULATION_DAY = 1;

export interface RemotePayCalculationDayMigrationResult {
  scanned: number;
  updated: number;
  updatedUids: string[];
}

export async function migrateRemotePayCalculationDay(): Promise<RemotePayCalculationDayMigrationResult> {
  const snap = await getDocs(collection(db, 'users'));

  const missing = snap.docs.filter(d => typeof d.data().remotePayCalculationDay !== 'number');

  await Promise.all(
    missing.map(d =>
      updateDoc(doc(db, 'users', d.id), {
        remotePayCalculationDay: DEFAULT_REMOTE_PAY_CALCULATION_DAY,
      }),
    ),
  );

  return {
    scanned: snap.size,
    updated: missing.length,
    updatedUids: missing.map(d => d.id),
  };
}

/**
 * One-time backfill: persist the denormalized `isRemote` boolean on every
 * users/{uid} doc so employee-side components (e.g. the ClockPunch Daily
 * Report trigger) can resolve Remote-ness authoritatively without reading the
 * manager/admin-only `workModels` collection.
 *
 * Remote-ness is derived via the shared `isRemoteWorkModel` SSOT (workModelId
 * → model name first, legacy workModel string fallback), so a user whose
 * legacy `workModel` string drifted from their `workModelId` FK is corrected
 * here. Triggered once on admin init alongside migrateRemotePayCalculationDay
 * (admin-only context — firestore.rules requires hasRole('admin') to update
 * other users' docs).
 *
 * Idempotent: docs whose stored `isRemote` already matches the resolved value
 * are skipped, so repeat runs are read-only no-ops once all docs are migrated.
 */
export interface IsRemoteBackfillResult {
  scanned: number;
  updated: number;
  updatedUids: string[];
}

export async function backfillIsRemoteFlag(): Promise<IsRemoteBackfillResult> {
  const workModels = await listWorkModels();
  const snap = await getDocs(collection(db, 'users'));

  const stale = snap.docs.filter(d => {
    const data = d.data();
    const resolved = isRemoteWorkModel(
      {
        workModel: data.workModel === 'Remote' ? 'Remote' : 'On-site',
        workModelId: data.workModelId as string | undefined,
      },
      workModels,
    );
    // Update when the flag is missing or disagrees with the resolved value.
    return typeof data.isRemote !== 'boolean' || data.isRemote !== resolved;
  });

  await Promise.all(
    stale.map(d => {
      const data = d.data();
      const resolved = isRemoteWorkModel(
        {
          workModel: data.workModel === 'Remote' ? 'Remote' : 'On-site',
          workModelId: data.workModelId as string | undefined,
        },
        workModels,
      );
      return updateDoc(doc(db, 'users', d.id), { isRemote: resolved });
    }),
  );

  return {
    scanned: snap.size,
    updated: stale.length,
    updatedUids: stale.map(d => d.id),
  };
}
