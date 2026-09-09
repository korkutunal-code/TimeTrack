import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { AlertTriangle, Loader2, Plus, Trash2 } from 'lucide-react';

import { db } from '../../lib/firebase';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import {
  validateSegmentChronology,
  getSegmentOverlapError,
} from '../../../utils/timeValidation';
import { getLocalDate } from '../../../utils/timeCalculations';
import { isExcludedByCutoff } from '../../../utils/exclusionFilter';
import {
  recomputeSegmentSystemTimestamps,
  type TimeSegment,
} from '../../lib/database';

/** One editable shift card in the Add Workday modal. */
export interface NewShiftInput {
  key: string;
  clockInManual: string;
  lunchOutManual: string;
  lunchInManual: string;
  clockOutManual: string;
  skipLunch: boolean;
}

let shiftKeyCounter = 0;
function freshShift(): NewShiftInput {
  shiftKeyCounter += 1;
  return {
    key: `new_${Date.now()}_${shiftKeyCounter}`,
    clockInManual: '',
    lunchOutManual: '',
    lunchInManual: '',
    clockOutManual: '',
    skipLunch: false,
  };
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface AddWorkdayModalProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called with the validated workday (date + shifts). The parent inserts the
   * row into the Daily Breakdown bulk-edit state (staged, not persisted) and
   * is responsible for epoch/total recomputation on final save.
   */
  onAdd: (workDate: string, shifts: NewShiftInput[]) => void;
  /** Employee IANA timezone — manual HH:MM strings live in this zone. */
  employeeTimezone?: string;
  /** The employee's uid — used to pre-check Firestore for an existing doc on
      the picked date (covers dates outside the loaded report range). */
  employeeUserId: string;
  /** Dates that already have a row in the breakdown (a second workday for the
      same date is rejected — edit the existing row instead). */
  existingDates: string[];
  /**
   * Admin "Exclude Records From Analysis" cutoff (PT YYYY-MM-DD, inclusive).
   * Days on/before it are dropped from the report — adding a workday there is
   * allowed but the row won't appear, so the admin is warned.
   */
  excludeBefore?: string;
}

/**
 * Add Workday modal — lets an admin/manager stage a brand-new workday (with
 * one or more shifts) into the Daily Breakdown bulk-edit session. Mirrors the
 * "Correct Time Entry" dialog layout: backdrop-blur overlay + rounded card +
 * per-shift 2x2 time grid with a "+ Add Shift" button.
 *
 * The modal is a pure form: it validates the entered times (HH:MM format,
 * chronology, and same-day shift overlap) and hands the clean shift list to
 * the parent via onAdd. Future-punch rejection is intentionally left to the
 * table's live errors memo + the saveAll guard (which re-check with a fresh
 * clock), so a staged workday is still caught before persistence. Nothing is
 * written to Firestore here — persistence happens on "Save All Changes".
 */
export function AddWorkdayModal({ open, onClose, onAdd, employeeTimezone, employeeUserId, existingDates, excludeBefore }: AddWorkdayModalProps) {
  const [workDate, setWorkDate] = useState('');
  const [shifts, setShifts] = useState<NewShiftInput[]>([freshShift()]);
  const [submitting, setSubmitting] = useState(false);
  // Async Firestore duplicate check for the picked date (catches dates outside
  // the currently-loaded report range, which `existingDates` can't see).
  const [remoteDup, setRemoteDup] = useState<'checking' | 'exists' | 'clear' | null>(null);
  const dupCheckSeq = useRef(0);

  // Latest date the picker allows: the employee's local today (a future-dated
  // workday is rejected at save by the future-punch guard; cap it here too).
  const maxDate = useMemo(() => getLocalDate(employeeTimezone), [employeeTimezone]);

  const reset = () => {
    setWorkDate('');
    setShifts([freshShift()]);
    setRemoteDup(null);
  };

  // Pre-check Firestore for an existing timeEntries doc on the picked date.
  useEffect(() => {
    const seq = ++dupCheckSeq.current;
    if (!workDate || existingDates.includes(workDate)) {
      // Clear via microtask so no setState runs synchronously in the effect.
      Promise.resolve().then(() => { if (dupCheckSeq.current === seq) setRemoteDup(null); });
      return;
    }
    // Mark "checking" asynchronously (microtask), then resolve with the result.
    Promise.resolve().then(() => { if (dupCheckSeq.current === seq) setRemoteDup('checking'); });
    getDoc(doc(db, 'timeEntries', `${employeeUserId}_${workDate}`))
      .then((snap) => { if (dupCheckSeq.current === seq) setRemoteDup(snap.exists() ? 'exists' : 'clear'); })
      .catch(() => { if (dupCheckSeq.current === seq) setRemoteDup('clear'); }); // network fail → don't block; saveAll re-guards
  }, [workDate, employeeUserId, existingDates]);

  const updateShift = (key: string, field: keyof NewShiftInput, value: string | boolean) => {
    setShifts(prev => prev.map(s => (s.key === key ? { ...s, [field]: value } : s)));
  };
  const addShift = () => setShifts(prev => [...prev, freshShift()]);
  const removeShift = (key: string) => setShifts(prev => (prev.length > 1 ? prev.filter(s => s.key !== key) : prev));

  // Per-shift validation errors, keyed by shift key → field → message. Uses the
  // same canonical chronology validator as the bulk-edit grid so the rules match.
  const errors = useMemo(() => {
    const m = new Map<string, Map<string, string>>();
    const epochSegs: TimeSegment[] = [];
    for (const s of shifts) {
      const fieldErrs = new Map<string, string>();
      const { clockInManual: ci, lunchOutManual: lo, lunchInManual: li, clockOutManual: co } = s;
      for (const [field, v] of [['clockInManual', ci], ['lunchOutManual', lo], ['lunchInManual', li], ['clockOutManual', co]] as [keyof NewShiftInput, string][]) {
        if (v && !HHMM_RE.test(v)) fieldErrs.set(field, 'Invalid time (HH:MM)');
      }
      if (!ci) fieldErrs.set('clockInManual', 'Clock in is required');
      else if (!co) fieldErrs.set('clockOutManual', 'Clock out is required');
      if (fieldErrs.size === 0) {
        const chrono = validateSegmentChronology(
          {
            clockInManual: ci,
            lunchOutManual: s.skipLunch ? '' : lo,
            lunchInManual: s.skipLunch ? '' : li,
            clockOutManual: co,
            skipLunch: s.skipLunch,
          },
          { allowOpen: false },
        );
        for (const msg of chrono) fieldErrs.set('clockOutManual', msg);
        // Chronology-clean: resolve to epochs for the overlap guard.
        const es = recomputeSegmentSystemTimestamps(
          {
            id: s.key,
            clockInManual: ci,
            lunchOutManual: s.skipLunch ? '' : lo,
            lunchInManual: s.skipLunch ? '' : li,
            clockOutManual: co,
            skipLunch: s.skipLunch,
            complete: true,
          },
          workDate || undefined,
          employeeTimezone,
        );
        if (typeof es.clockInSystem === 'number' && typeof es.clockOutSystem === 'number') {
          epochSegs.push(es);
        }
      }
      if (fieldErrs.size > 0) m.set(s.key, fieldErrs);
    }
    // Same-day overlap across the new shifts.
    const overlapMsg = epochSegs.length > 1 ? getSegmentOverlapError(epochSegs) : null;
    if (overlapMsg) {
      for (const es of epochSegs) {
        if (!m.has(es.id)) m.set(es.id, new Map());
        m.get(es.id)!.set('clockInManual', 'Shifts on this day overlap');
      }
    }
    return m;
  }, [shifts, workDate, employeeTimezone]);

  const dateError = useMemo(() => {
    if (!workDate) return 'Date is required';
    if (existingDates.includes(workDate)) return 'A workday already exists for this date — edit it in the table instead';
    if (remoteDup === 'exists') return 'A time entry already exists for this date — cancel and edit the existing row instead';
    if (remoteDup === 'checking') return null; // don't flash an error while checking
    return null;
  }, [workDate, existingDates, remoteDup]);

  // Non-blocking warning: the picked date falls inside the admin's "Exclude
  // Records From Analysis" window, so the created workday won't appear in the
  // report being viewed.
  const exclusionWarning = useMemo(() => {
    const cutoff = (excludeBefore || '').trim();
    if (!cutoff || !workDate) return null;
    if (isExcludedByCutoff(workDate, cutoff)) {
      return `This date is excluded from analysis because the "Exclude Records From Analysis" setting is excluding all records on or before ${cutoff}.`;
    }
    return null;
  }, [workDate, excludeBefore]);

  const valid = !dateError && errors.size === 0 && remoteDup !== 'checking' && remoteDup !== 'exists';

  const handleAdd = () => {
    if (!valid) return;
    setSubmitting(true);
    try {
      onAdd(workDate, shifts);
      reset();
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  const fieldErr = (key: string, field: string) => errors.get(key)?.get(field);
  const inputCls = (key: string, field: string) =>
    fieldErr(key, field)
      ? 'border-red-400 bg-red-50 focus-visible:ring-red-400'
      : '';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Workday</DialogTitle>
          <DialogDescription>
            Manually add a missing workday. The day is staged into the Daily
            Breakdown and saved when you click "Save All Changes".
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="max-w-[240px]">
            <Label>Date</Label>
            <Input
              type="date"
              value={workDate}
              max={maxDate}
              onChange={(e) => setWorkDate(e.target.value)}
              className={!workDate || dateError && workDate ? (workDate && dateError ? 'border-red-400 bg-red-50' : '') : ''}
            />
            {workDate && dateError && (
              <p className="mt-1 text-xs text-red-600">{dateError}</p>
            )}
            {workDate && remoteDup === 'checking' && (
              <p className="mt-1 text-xs text-slate-500">Checking for an existing entry…</p>
            )}
          </div>

          {exclusionWarning && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <AlertTriangle className="size-4 text-amber-600 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-800">{exclusionWarning}</p>
            </div>
          )}

          {/* One card per shift — same layout as Correct Time Entry. */}
          <div className="space-y-3">
            {shifts.map((shift, idx) => (
              <div key={shift.key} className="p-4 border rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700">Shift {idx + 1}</p>
                  <button
                    type="button"
                    aria-label={`Delete shift ${idx + 1}`}
                    disabled={shifts.length <= 1}
                    onClick={() => removeShift(shift.key)}
                    className="inline-flex items-center justify-center p-1.5 rounded-lg border border-red-200 bg-red-50/60 text-red-600 cursor-pointer transition-all duration-150 hover:bg-red-100 hover:border-red-300 hover:text-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Clock In</Label>
                    <Input
                      type="time"
                      value={shift.clockInManual}
                      onChange={(e) => updateShift(shift.key, 'clockInManual', e.target.value)}
                      className={inputCls(shift.key, 'clockInManual')}
                    />
                    {fieldErr(shift.key, 'clockInManual') && <p className="mt-1 text-xs text-red-600">{fieldErr(shift.key, 'clockInManual')}</p>}
                  </div>
                  {!shift.skipLunch && (
                    <div>
                      <Label>Lunch Out <span className="text-slate-400 font-normal">(optional)</span></Label>
                      <Input
                        type="time"
                        value={shift.lunchOutManual}
                        onChange={(e) => updateShift(shift.key, 'lunchOutManual', e.target.value)}
                        className={inputCls(shift.key, 'lunchOutManual')}
                      />
                      {fieldErr(shift.key, 'lunchOutManual') && <p className="mt-1 text-xs text-red-600">{fieldErr(shift.key, 'lunchOutManual')}</p>}
                    </div>
                  )}
                  {!shift.skipLunch && (
                    <div>
                      <Label>Lunch In <span className="text-slate-400 font-normal">(optional)</span></Label>
                      <Input
                        type="time"
                        value={shift.lunchInManual}
                        onChange={(e) => updateShift(shift.key, 'lunchInManual', e.target.value)}
                        className={inputCls(shift.key, 'lunchInManual')}
                      />
                      {fieldErr(shift.key, 'lunchInManual') && <p className="mt-1 text-xs text-red-600">{fieldErr(shift.key, 'lunchInManual')}</p>}
                    </div>
                  )}
                  <div>
                    <Label>Clock Out</Label>
                    <Input
                      type="time"
                      value={shift.clockOutManual}
                      onChange={(e) => updateShift(shift.key, 'clockOutManual', e.target.value)}
                      className={inputCls(shift.key, 'clockOutManual')}
                    />
                    {fieldErr(shift.key, 'clockOutManual') && <p className="mt-1 text-xs text-red-600">{fieldErr(shift.key, 'clockOutManual')}</p>}
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                  <Checkbox
                    checked={shift.skipLunch}
                    onCheckedChange={(c) => updateShift(shift.key, 'skipLunch', c === true)}
                  />
                  Skip lunch (no lunch break taken)
                </label>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addShift}>
              <Plus className="size-4 mr-2" />
              Add Shift
            </Button>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { reset(); onClose(); }} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!valid || submitting}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {submitting ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
