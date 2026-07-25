import { collection, doc, getDocs, addDoc, updateDoc, query, limit, where } from 'firebase/firestore';
import { db } from '../app/lib/firebase';

export interface WorkModel {
  id: string;
  name: string;
  noOvertime: boolean;
  overtimeLimit: number;
  overtimeMultiplier: number;
  doubleTimeLimit: number;
  doubleTimeMultiplier: number;
  weeklyOvertimeLimit: number;
  status?: 'active' | 'voided';
}

export interface WorkModelInput {
  name: string;
  noOvertime: boolean;
  overtimeLimit: number;
  overtimeMultiplier: number;
  doubleTimeLimit: number;
  doubleTimeMultiplier: number;
  weeklyOvertimeLimit: number;
}

const DEFAULT_MODELS: WorkModelInput[] = [
  {
    name: 'On-site',
    noOvertime: false,
    overtimeLimit: 8,
    overtimeMultiplier: 1.5,
    doubleTimeLimit: 12,
    doubleTimeMultiplier: 2.0,
    weeklyOvertimeLimit: 40,
  },
  {
    name: 'Remote',
    noOvertime: true,
    overtimeLimit: 8,
    overtimeMultiplier: 1.5,
    doubleTimeLimit: 12,
    doubleTimeMultiplier: 2.0,
    weeklyOvertimeLimit: 40,
  },
];

function mapDoc(id: string, data: any): WorkModel {
  return {
    id,
    name: String(data.name || ''),
    noOvertime: data.noOvertime === true,
    overtimeLimit: Number(data.overtimeLimit ?? 8),
    overtimeMultiplier: Number(data.overtimeMultiplier ?? 1.5),
    doubleTimeLimit: Number(data.doubleTimeLimit ?? 12),
    doubleTimeMultiplier: Number(data.doubleTimeMultiplier ?? 2.0),
    weeklyOvertimeLimit: Number(data.weeklyOvertimeLimit ?? 40),
    status: data.status === 'voided' ? 'voided' : 'active',
  };
}

export async function listWorkModels(): Promise<WorkModel[]> {
  // Only active models are surfaced to Settings UI / pill resolver / dropdown.
  // Voided docs remain in the collection for referential integrity (users may
  // still reference a voided model via workModelId; the UI falls back gracefully).
  const snap = await getDocs(query(collection(db, 'workModels'), where('status', '!=', 'voided'), limit(500)));
  if (snap.empty) {
    await ensureSeeded();
    const reSnap = await getDocs(query(collection(db, 'workModels'), where('status', '!=', 'voided'), limit(500)));
    return reSnap.docs.map(d => mapDoc(d.id, d.data()));
  }
  return snap.docs.map(d => mapDoc(d.id, d.data()));
}

export async function ensureSeeded(): Promise<void> {
  // Only seed if there are no ACTIVE models. A collection of only-voided docs
  // (everything deleted) should still re-seed the defaults so the app isn't
  // left with zero usable models.
  const snap = await getDocs(query(collection(db, 'workModels'), where('status', '!=', 'voided'), limit(1)));
  if (!snap.empty) return;
  for (const model of DEFAULT_MODELS) {
    await addDoc(collection(db, 'workModels'), { ...model, status: 'active' });
  }
}

export async function createWorkModel(input: WorkModelInput): Promise<WorkModel> {
  const ref = await addDoc(collection(db, 'workModels'), { ...input, status: 'active' });
  return { id: ref.id, ...input, status: 'active' };
}

export async function updateWorkModel(id: string, input: WorkModelInput): Promise<WorkModel> {
  // Re-assert status: 'active' on write so the persisted doc matches the
  // returned object. This also gives "edit restores an active model" semantics
  // for any direct API caller (the UI only edits already-active models since
  // voided ones are excluded from the list).
  await updateDoc(doc(db, 'workModels', id), { ...input, status: 'active' });
  return { id, ...input, status: 'active' };
}

export async function deleteWorkModel(id: string): Promise<void> {
  // Soft delete only — never hard-delete. Sets status to 'voided' so the doc
  // remains resolvable for any user whose workModelId still points at it,
  // but is excluded from active model lists. (AGENTS.md soft-delete rule +
  // referential integrity for users.workModelId.)
  await updateDoc(doc(db, 'workModels', id), { status: 'voided' });
}
