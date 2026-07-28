import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { fetchGlobalSettings, DEFAULT_SETTINGS, type GlobalSettings } from '../../../services/systemSettingsService';
import { User } from '../../lib/auth';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { toast } from 'sonner';
import { Save, Loader2, ChevronDown, RotateCcw, X as XIcon } from 'lucide-react';
import { WorkModelsCard } from './WorkModelsCard';

interface SystemSettingsViewProps {
  currentUser: User;
}

type SystemSettings = GlobalSettings;

/**
 * Imperative handle exposed to the parent (App.tsx) so it can drive the
 * unsaved-changes navigation guard without coupling to the internal form
 * state. App.tsx calls `isDirty()` to decide whether to intercept a tab
 * switch, and `save()` / `discard()` from the Unsaved Changes modal.
 */
export interface SettingsGuard {
  isDirty: () => boolean;
  save: () => Promise<boolean>;
  discard: () => void;
  /** Highlight every field that differs from initialSettings (used when the
   *  user picks "get back to the settings"). Cleared on save/discard. */
  highlightDirty: () => void;
}

const settingsEqual = (a: SystemSettings, b: SystemSettings): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export const SystemSettingsView = forwardRef<SettingsGuard, SystemSettingsViewProps>(
  function SystemSettingsView({ currentUser }, ref) {
  const [systemSettings, setSystemSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [initialSettings, setInitialSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isReminderSettingsOpen, setIsReminderSettingsOpen] = useState(false);
  const [isPayrollSettingsOpen, setIsPayrollSettingsOpen] = useState(false);
  const [isLockPeriodOpen, setIsLockPeriodOpen] = useState(false);
  const [showHighlight, setShowHighlight] = useState(false);

  const isDirty = !settingsEqual(systemSettings, initialSettings);

  // Keep a live ref of dirty state + handlers so the parent's guard can call
  // them imperatively (App.tsx holds a ref to this component).
  const stateRef = useRef({
    systemSettings,
    initialSettings,
    isDirty,
  });
  stateRef.current = { systemSettings, initialSettings, isDirty };

  const saveInternal = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      // Single consolidated write: all 9 settings fields + audit metadata in
      // one document (systemSettings/global). { merge: true } preserves any
      // extra fields other services may have added.
      const payload: Record<string, unknown> = {
        enable_email_reminders: systemSettings.enable_email_reminders,
        enable_sms_reminders: systemSettings.enable_sms_reminders,
        enable_lunch_reminder: systemSettings.enable_lunch_reminder,
        enable_clockout_reminder: systemSettings.enable_clockout_reminder,
        enable_longshift_reminder: systemSettings.enable_longshift_reminder,
        lunch_reminder_time: systemSettings.lunch_reminder_time,
        clockout_reminder_time: systemSettings.clockout_reminder_time,
        longshift_threshold_hours: systemSettings.longshift_threshold_hours,
        payroll_cycle_type: systemSettings.payroll_cycle_type,
        weekly_start_day: systemSettings.weekly_start_day,
        biweekly_start_date: systemSettings.biweekly_start_date,
        monthly_start_day: systemSettings.monthly_start_day,
        locked_up_to_date: systemSettings.locked_up_to_date,
        updatedAt: Timestamp.now(),
        updatedBy: currentUser.uid,
      };
      // Accuracy guard: only stamp the payroll-lock audit fields when the lock
      // date actually changed in this save. Previously these were stamped on
      // every save (even a reminder-time-only edit), which misrecorded who/when
      // "locked" the period. The field names are explicit about their meaning.
      if (systemSettings.locked_up_to_date !== initialSettings.locked_up_to_date) {
        payload.payroll_entries_locked_at = Timestamp.now();
        payload.payroll_entries_locked_by = currentUser.uid;
      }
      await setDoc(doc(db, 'systemSettings', 'global'), payload, { merge: true });

      setInitialSettings({ ...systemSettings });
      setShowHighlight(false);
      toast.success("Settings saved successfully");
      return true;
    } catch (e) {
      console.error(e);
      toast.error("Failed to save settings");
      return false;
    } finally {
      setSaving(false);
    }
  }, [systemSettings, currentUser.uid, initialSettings.locked_up_to_date]);

  const discardInternal = useCallback(() => {
    setSystemSettings({ ...stateRef.current.initialSettings });
    setShowHighlight(false);
  }, []);

  useImperativeHandle(ref, () => ({
    isDirty: () => stateRef.current.isDirty,
    save: saveInternal,
    discard: discardInternal,
    highlightDirty: () => {
      setShowHighlight(true);
    },
  }), [saveInternal, discardInternal]);

  const loadSettings = async () => {
    setLoadingSettings(true);
    try {
      // Single consolidated read with read-through fallback: reads
      // systemSettings/global; falls back to the legacy reminders/payroll
      // docs (merged) when global doesn't exist yet, so a not-yet-migrated
      // deployment keeps honoring configured values instead of reverting to
      // hardcoded defaults.
      const next = await fetchGlobalSettings();
      if (next) {
        setSystemSettings(next);
        setInitialSettings(next);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to load settings");
    } finally {
      setLoadingSettings(false);
    }
  };

  useEffect(() => {
    loadSettings();
  }, []);

  // Field updater.
  const update = <K extends keyof SystemSettings>(key: K, value: SystemSettings[K]) => {
    setSystemSettings((prev) => ({ ...prev, [key]: value }));
  };

  // Compute the set of dirty field keys for highlight mode.
  const dirtyFields = new Set<keyof SystemSettings>();
  if (showHighlight) {
    (Object.keys(systemSettings) as (keyof SystemSettings)[]).forEach((key) => {
      if (JSON.stringify(systemSettings[key]) !== JSON.stringify(initialSettings[key])) {
        dirtyFields.add(key);
      }
    });
  }

  // Reusable highlight class for a given field. Amber was chosen because it is
  // not otherwise used on the Settings screen (brand/slate/red are in use).
  const fieldHighlight = (key: keyof SystemSettings): string =>
    dirtyFields.has(key) ? 'ring-2 ring-amber-400 bg-amber-50/20' : '';

  if (loadingSettings) {
    return (
      <Card className="border border-white/60 shadow-xl bg-white/70 backdrop-blur-xl rounded-2xl">
        <CardContent className="py-12 text-center text-sm text-slate-500">
          Loading settings...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border border-white/60 shadow-xl bg-white/70 backdrop-blur-xl rounded-2xl">
        <CardHeader className="bg-white/40 pb-2">
          <button
            type="button"
            onClick={() => setIsReminderSettingsOpen((open) => !open)}
            aria-expanded={isReminderSettingsOpen}
            className="w-full flex items-center justify-between text-left"
          >
            <CardTitle className="text-slate-800 font-bold">Reminder Settings <span className="text-slate-400 font-normal">- Coming Soon</span></CardTitle>
            <ChevronDown
              className={`size-5 text-slate-500 transition-transform duration-200 ${isReminderSettingsOpen ? 'rotate-180' : 'rotate-0'}`}
            />
          </button>
        </CardHeader>
        {isReminderSettingsOpen && (
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
              <div className="space-y-4">
                <label className="flex items-center gap-2">
                  <Checkbox
                    id="globalEmail"
                    checked={systemSettings.enable_email_reminders}
                    onCheckedChange={(checked) => update('enable_email_reminders', !!checked)}
                  />
                  <Label htmlFor="globalEmail">Enable Email Reminders Globally</Label>
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    id="globalSMS"
                    checked={systemSettings.enable_sms_reminders}
                    onCheckedChange={(checked) => update('enable_sms_reminders', !!checked)}
                  />
                  <Label htmlFor="globalSMS">Enable SMS Reminders Globally</Label>
                </label>
              </div>

              <div className={`space-y-1.5 rounded-lg p-1.5 -m-1.5 transition-colors ${fieldHighlight('enable_lunch_reminder')}`}>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={systemSettings.enable_lunch_reminder}
                    onCheckedChange={(checked) => update('enable_lunch_reminder', !!checked)}
                  />
                  <Label>Lunch Reminder</Label>
                </label>
                <Input
                  type="time"
                  value={systemSettings.lunch_reminder_time}
                  onChange={(e) => update('lunch_reminder_time', e.target.value)}
                  className="max-w-[140px] rounded-lg border-slate-200 text-sm py-1.5 px-3"
                />
                <p className="text-xs text-slate-400">If they haven't logged lunch out. Pacific time.</p>
              </div>

              <div className={`space-y-1.5 rounded-lg p-1.5 -m-1.5 transition-colors ${fieldHighlight('enable_clockout_reminder')}`}>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={systemSettings.enable_clockout_reminder}
                    onCheckedChange={(checked) => update('enable_clockout_reminder', !!checked)}
                  />
                  <Label>Clock Out Reminder</Label>
                </label>
                <Input
                  type="time"
                  value={systemSettings.clockout_reminder_time}
                  onChange={(e) => update('clockout_reminder_time', e.target.value)}
                  className="max-w-[140px] rounded-lg border-slate-200 text-sm py-1.5 px-3"
                />
                <p className="text-xs text-slate-400">If still clocked in. Pacific time.</p>
              </div>

              <div className={`space-y-1.5 rounded-lg p-1.5 -m-1.5 transition-colors ${fieldHighlight('enable_longshift_reminder')}`}>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={systemSettings.enable_longshift_reminder}
                    onCheckedChange={(checked) => update('enable_longshift_reminder', !!checked)}
                  />
                  <Label>Long Shift Threshold (Hours)</Label>
                </label>
                <Input
                  type="number"
                  min="1"
                  max="24"
                  value={systemSettings.longshift_threshold_hours}
                  onChange={(e) => update('longshift_threshold_hours', parseFloat(e.target.value) || 10)}
                  className="max-w-[140px] rounded-lg border-slate-200 text-sm py-1.5 px-3"
                />
                <p className="text-xs text-slate-400">Warn if worked in over this amount of hours.</p>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      <Card className="border border-white/60 shadow-xl bg-white/70 backdrop-blur-xl rounded-2xl">
        <CardHeader className="bg-white/40 pb-2">
          <button
            type="button"
            onClick={() => setIsPayrollSettingsOpen((open) => !open)}
            aria-expanded={isPayrollSettingsOpen}
            className="w-full flex items-center justify-between text-left"
          >
            <CardTitle className="text-slate-800 font-bold">Payroll Settings</CardTitle>
            <ChevronDown
              className={`size-5 text-slate-500 transition-transform duration-200 ${isPayrollSettingsOpen ? 'rotate-180' : 'rotate-0'}`}
            />
          </button>
        </CardHeader>
        {isPayrollSettingsOpen && (
        <CardContent className="space-y-4 pt-4">
          <div className={`rounded-lg p-1.5 -m-1.5 transition-colors ${fieldHighlight('payroll_cycle_type')}`}>
            <Label>Payroll Cycle Type</Label>
            <Select
              value={systemSettings.payroll_cycle_type}
              onValueChange={(val) => update('payroll_cycle_type', val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="biweekly">Bi-weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {systemSettings.payroll_cycle_type === 'weekly' && (
            <div className={`rounded-lg p-1.5 -m-1.5 transition-colors ${fieldHighlight('weekly_start_day')}`}>
              <Label>Week Start Day</Label>
              <Select
                value={systemSettings.weekly_start_day.toString()}
                onValueChange={(val) => update('weekly_start_day', parseInt(val, 10))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">Sunday</SelectItem>
                  <SelectItem value="1">Monday</SelectItem>
                  <SelectItem value="2">Tuesday</SelectItem>
                  <SelectItem value="3">Wednesday</SelectItem>
                  <SelectItem value="4">Thursday</SelectItem>
                  <SelectItem value="5">Friday</SelectItem>
                  <SelectItem value="6">Saturday</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {systemSettings.payroll_cycle_type === 'biweekly' && (
            <div className={`rounded-lg p-1.5 -m-1.5 transition-colors ${fieldHighlight('biweekly_start_date')}`}>
              <Label>Cycle Anchor Date</Label>
              <Input
                type="date"
                value={systemSettings.biweekly_start_date}
                onChange={(e) => update('biweekly_start_date', e.target.value)}
              />
              <p className="text-xs text-slate-400 mt-1">Select any date that marks the start of a bi-weekly cycle.</p>
            </div>
          )}

          {systemSettings.payroll_cycle_type === 'monthly' && (
            <div className={`rounded-lg p-1.5 -m-1.5 transition-colors ${fieldHighlight('monthly_start_day')}`}>
              <Label>Monthly Cycle Start Day</Label>
              <Input
                type="number"
                min="1"
                max="28"
                value={systemSettings.monthly_start_day}
                onChange={(e) => update('monthly_start_day', Math.min(28, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                className="max-w-[140px]"
              />
              <p className="text-xs text-slate-400 mt-1">Day of month (1–28) that marks the start of each monthly cycle. Use 1 for calendar months.</p>
            </div>
          )}
        </CardContent>
        )}
      </Card>

      {/* Lock Payroll Period — destyled to match the other cards (no red). */}
      <Card className="border border-white/60 shadow-xl bg-white/70 backdrop-blur-xl rounded-2xl">
        <CardHeader className="bg-white/40 pb-2">
          <button
            type="button"
            onClick={() => setIsLockPeriodOpen((open) => !open)}
            aria-expanded={isLockPeriodOpen}
            className="w-full flex items-center justify-between text-left"
          >
            <CardTitle className="text-slate-800 font-bold">Lock Payroll Period</CardTitle>
            <ChevronDown
              className={`size-5 text-slate-500 transition-transform duration-200 ${isLockPeriodOpen ? 'rotate-180' : 'rotate-0'}`}
            />
          </button>
        </CardHeader>
        {isLockPeriodOpen && (
        <CardContent className="space-y-3 pt-4">
          <div className={`space-y-3 bg-white p-4 border border-slate-200 rounded-lg transition-colors ${fieldHighlight('locked_up_to_date')}`}>
            <div>
              <Label className="text-slate-900">Lock Entries Up To (Inclusive)</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="date"
                  value={systemSettings.locked_up_to_date}
                  onChange={(e) => update('locked_up_to_date', e.target.value)}
                  className="border-slate-200"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => update('locked_up_to_date', '')}
                  disabled={!systemSettings.locked_up_to_date}
                  className="h-9 shrink-0"
                  title="Clear lock date"
                >
                  <XIcon className="size-4" />
                  Clear
                </Button>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Setting a date here will prevent any edits or corrections for time entries on or before this date. Clear the date to unlock all periods.
              </p>
            </div>
          </div>
        </CardContent>
        )}
      </Card>

      <WorkModelsCard />

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          onClick={discardInternal}
          disabled={!isDirty || saving}
        >
          <RotateCcw className="size-4 mr-2" />
          Discard changes
        </Button>
        <Button
          onClick={saveInternal}
          disabled={!isDirty || saving}
        >
          {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
});
