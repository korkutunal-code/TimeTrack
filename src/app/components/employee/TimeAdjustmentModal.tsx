import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Clock, Coffee, LogOut, LogIn, AlertCircle, Loader2, Pencil, Send } from 'lucide-react';

import type { User } from '../../lib/auth';
import { dbService, type TimeEntry, type CorrectionRequest } from '../../lib/database';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../ui/dialog';
import { getCurrentPTDate, subtractPTDays } from '../../../utils/timeCalculations';

type EditableField = 'clockInManual' | 'lunchOutManual' | 'lunchInManual' | 'clockOutManual';

interface FieldConfig {
  key: EditableField;
  label: string;
  icon: React.ReactNode;
  issueType: string;
  systemKey: 'clockInSystem' | 'lunchOutSystem' | 'lunchInSystem' | 'clockOutSystem';
  isLunch: boolean;
}

const FIELDS: FieldConfig[] = [
  { key: 'clockInManual', label: 'Clock In', icon: <LogIn className="size-3.5" />, issueType: 'Clock In', systemKey: 'clockInSystem', isLunch: false },
  { key: 'lunchOutManual', label: 'Lunch Out', icon: <Coffee className="size-3.5" />, issueType: 'Lunch Out', systemKey: 'lunchOutSystem', isLunch: true },
  { key: 'lunchInManual', label: 'Lunch In', icon: <Coffee className="size-3.5" />, issueType: 'Lunch In', systemKey: 'lunchInSystem', isLunch: true },
  { key: 'clockOutManual', label: 'Clock Out', icon: <LogOut className="size-3.5" />, issueType: 'Clock Out', systemKey: 'clockOutSystem', isLunch: false },
];

const ACTIVE_STATUSES: CorrectionRequest['status'][] = ['Pending', 'Open', 'In Progress'];

/** Get the system (epoch millis) timestamp for a given field on an entry. */
function systemTsFor(entry: TimeEntry, field: FieldConfig): number | undefined {
  return (entry as any)[field.systemKey] as number | undefined;
}

/** Whether a system timestamp is within the last 24 hours (direct-edit window). */
function within24h(ts: number | undefined): boolean {
  if (!ts) return false;
  return Date.now() - ts <= 24 * 60 * 60 * 1000;
}

interface TimeAdjustmentModalProps {
  user: User;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Quick Edit & Correction Request modal.
 *
 * Shows the last 14 days of the employee's time entries as an editable table.
 * Clicking a time cell:
 *  - ≤24h old (by the field's system timestamp): INLINE DIRECT EDIT — updates
 *    timeEntries + auditLog (employee self-audit) instantly.
 *  - >24h old (or no system ts): CORRECTION REQUEST — creates a `correctionRequests`
 *    doc (status "Pending") for admin approval; the cell shows a yellow
 *    "Pending" badge while the request is active.
 */
export function TimeAdjustmentModal({ user, open, onClose, onSaved }: TimeAdjustmentModalProps) {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [requests, setRequests] = useState<CorrectionRequest[]>([]);
  const [loading, setLoading] = useState(false);

  // Inline direct-edit state (≤24h path).
  const [editing, setEditing] = useState<{ entryId: string; field: EditableField } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editReason, setEditReason] = useState('');

  // Correction-request form state (>24h path).
  const [requesting, setRequesting] = useState<{ entry: TimeEntry; field: FieldConfig } | null>(null);
  const [reqTime, setReqTime] = useState('');
  const [reqReason, setReqReason] = useState('');

  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const today = getCurrentPTDate();
      const start = subtractPTDays(today, 13); // 14-day window inclusive
      const [ents, reqs] = await Promise.all([
        dbService.getTimeEntriesForUserInRange(user.uid, start, today),
        dbService.getActiveCorrectionRequestsForUser(user.uid),
      ]);
      setEntries(ents.filter((e) => e.status !== 'voided' && e.status !== 'archived'));
      setRequests(reqs);
    } catch (e: any) {
      toast.error('Failed to load entries: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }, [user.uid]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) load();
  }, [open, load]);

  // Active-request lookup keyed by `${date}|${issueType}`.
  const activeRequestMap = new Map<string, CorrectionRequest>();
  for (const r of requests) {
    activeRequestMap.set(`${r.requested_date}|${r.issue_type}`, r);
  }

  const handleCellClick = (entry: TimeEntry, field: FieldConfig) => {
    const current = (entry as any)[field.key] as string | undefined;
    if (!current) {
      toast.info(`No ${field.label.toLowerCase()} time recorded for this day.`);
      return;
    }
    const ts = systemTsFor(entry, field);
    if (within24h(ts)) {
      // Direct-edit path.
      setRequesting(null);
      setEditing({ entryId: entry.id, field: field.key });
      setEditValue(current);
      setEditReason('');
    } else {
      // Correction-request path.
      setEditing(null);
      setRequesting({ entry, field });
      setReqTime(current);
      setReqReason('');
    }
  };

  const saveDirectEdit = async () => {
    if (!editing) return;
    if (!editValue.trim()) {
      toast.error('Please enter a time (HH:MM).');
      return;
    }
    if (!editReason.trim()) {
      toast.error('A reason is required for any time adjustment.');
      return;
    }
    setSubmitting(true);
    try {
      await dbService.directEditTimeField({
        userId: user.uid,
        actorName: user.name,
        entryId: editing.entryId,
        field: editing.field,
        value: editValue.trim(),
        reason: editReason.trim(),
      });
      toast.success('Time updated.');
      setEditing(null);
      await load();
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Could not save the adjustment.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitCorrectionRequest = async () => {
    if (!requesting) return;
    if (!reqTime.trim()) {
      toast.error('Please enter the requested time.');
      return;
    }
    if (!reqReason.trim()) {
      toast.error('A reason is required.');
      return;
    }
    const { entry, field } = requesting;
    setSubmitting(true);
    try {
      // Build original_* context fields for the admin view.
      const original_lunch = entry.skipLunch
        ? 'Skipped'
        : entry.lunchOutManual && entry.lunchInManual
          ? `${entry.lunchOutManual} - ${entry.lunchInManual}`
          : undefined;

      await dbService.createCorrectionRequest({
        employee_id: user.uid,
        employee_name: user.name,
        requested_date: entry.date,
        issue_type: field.issueType,
        notes: reqReason.trim(),
        suggested_time: reqTime.trim(),
        requested_lunch: field.isLunch ? reqTime.trim() : undefined,
        original_clock_in: entry.clockInManual,
        original_clock_out: entry.clockOutManual,
        original_lunch,
        status: 'Pending',
        created_at: Date.now(),
      });

      toast.success('Correction request submitted — an admin will review it.');
      setRequesting(null);
      await load();
      onSaved();
    } catch (e: any) {
      toast.error(e.message || 'Could not submit the correction request.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-4" />
            Edit / Request Time Adjustments
          </DialogTitle>
          <DialogDescription>
            Last 14 days. Tap a time to edit — recent punches (within 24h) can be
            changed directly; older entries require a correction request for
            admin approval.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : entries.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            No time entries in the last 14 days.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-sm border-collapse min-w-[640px]">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b">
                  <th className="py-2 pr-3 font-semibold">Date</th>
                  {FIELDS.map((f) => (
                    <th key={f.key} className="py-2 px-2 font-semibold">
                      <span className="flex items-center gap-1">{f.icon}{f.label}</span>
                    </th>
                  ))}
                  <th className="py-2 pl-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-b last:border-0">
                    <td className="py-2 pr-3 align-top font-medium whitespace-nowrap">
                      {entry.date}
                    </td>
                    {FIELDS.map((field) => {
                      const value = (entry as any)[field.key] as string | undefined;
                      const isEditing =
                        editing?.entryId === entry.id && editing.field === field.key;
                      const isRequesting =
                        requesting?.entry.id === entry.id && requesting.field.key === field.key;
                      const activeReq = activeRequestMap.get(`${entry.date}|${field.issueType}`);
                      return (
                        <td key={field.key} className="py-2 px-2 align-top">
                          {isEditing ? (
                            // Inline direct-edit form (≤24h).
                            <div className="flex flex-col gap-1 min-w-[110px]">
                              <Input
                                type="time"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="h-8"
                                disabled={submitting}
                              />
                              <Input
                                placeholder="Reason (required)"
                                value={editReason}
                                onChange={(e) => setEditReason(e.target.value)}
                                className="h-8 text-xs"
                                disabled={submitting}
                              />
                              <div className="flex gap-1">
                                <Button size="sm" className="h-7 text-xs flex-1" onClick={saveDirectEdit} disabled={submitting}>
                                  {submitting ? <Loader2 className="size-3 animate-spin" /> : 'Save'}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(null)} disabled={submitting}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : isRequesting ? (
                            // Correction-request form (>24h).
                            <div className="flex flex-col gap-1 min-w-[110px]">
                              <Label className="text-xs text-muted-foreground">
                                Requested {field.label}
                              </Label>
                              <Input
                                type="time"
                                value={reqTime}
                                onChange={(e) => setReqTime(e.target.value)}
                                className="h-8"
                                disabled={submitting}
                              />
                              <Input
                                placeholder="Reason (required)"
                                value={reqReason}
                                onChange={(e) => setReqReason(e.target.value)}
                                className="h-8 text-xs"
                                disabled={submitting}
                              />
                              <div className="flex gap-1">
                                <Button size="sm" className="h-7 text-xs flex-1" onClick={submitCorrectionRequest} disabled={submitting}>
                                  {submitting ? <Loader2 className="size-3 animate-spin" /> : <><Send className="size-3 mr-1" />Submit</>}
                                </Button>
                                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRequesting(null)} disabled={submitting}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleCellClick(entry, field)}
                              className="group flex flex-col items-start gap-1 text-left rounded-md px-1.5 py-1 hover:bg-muted/60 transition-colors cursor-pointer"
                              title={value ? 'Click to edit or request a correction' : 'No time recorded'}
                            >
                              <span className="font-mono tabular-nums text-foreground">
                                {value || '—'}
                              </span>
                              {activeReq && (
                                <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px] px-1.5 py-0 h-4">
                                  Pending
                                </Badge>
                              )}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-2 pl-2 align-top">
                      <span className="text-xs text-muted-foreground">
                        {entry.status === 'corrected' ? 'Corrected' : entry.complete ? 'Complete' : 'Open'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
          <AlertCircle className="size-3.5 shrink-0" />
          Direct edits (≤24h) are recorded in the audit trail. Older changes need
          admin approval.
        </div>
      </DialogContent>
    </Dialog>
  );
}
