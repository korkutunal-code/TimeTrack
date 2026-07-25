import { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, limit } from 'firebase/firestore';
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
  };
}

export async function listWorkModels(): Promise<WorkModel[]> {
  const snap = await getDocs(query(collection(db, 'workModels'), limit(500)));
  if (snap.empty) {
    await ensureSeeded();
    const reSnap = await getDocs(query(collection(db, 'workModels'), limit(500)));
    return reSnap.docs.map(d => mapDoc(d.id, d.data()));
  }
  return snap.docs.map(d => mapDoc(d.id, d.data()));
}

export async function ensureSeeded(): Promise<void> {
  const snap = await getDocs(query(collection(db, 'workModels'), limit(1)));
  if (!snap.empty) return;
  for (const model of DEFAULT_MODELS) {
    await addDoc(collection(db, 'workModels'), model);
  }
}

export async function createWorkModel(input: WorkModelInput): Promise<WorkModel> {
  const ref = await addDoc(collection(db, 'workModels'), input);
  return { id: ref.id, ...input };
}

export async function updateWorkModel(id: string, input: WorkModelInput): Promise<WorkModel> {
  await updateDoc(doc(db, 'workModels', id), input);
  return { id, ...input };
}

export async function deleteWorkModel(id: string): Promise<void> {
  await deleteDoc(doc(db, 'workModels', id));
}
