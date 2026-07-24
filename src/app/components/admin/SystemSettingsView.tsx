import { useState, useEffect } from 'react';
import type { DocumentData } from 'firebase/firestore';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { User } from '../../lib/auth';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Checkbox } from '../ui/checkbox';
import { toast } from 'sonner';
import { Save, Loader2 } from 'lucide-react';

interface SystemSettingsViewProps {
  currentUser: User;
}

export function SystemSettingsView({ currentUser }: SystemSettingsViewProps) {
  const [systemSettings, setSystemSettings] = useState({
    enable_email_reminders: true,
    enable_sms_reminders: false,
    lunch_reminder_time: '15:00',
    clockout_reminder_time: '18:00',
    longshift_threshold_hours: 10,
    payroll_cycle_type: 'biweekly',
    weekly_start_day: 1,
    biweekly_start_date: '2024-01-01',
    locked_up_to_date: '',
  });
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadSettings = async () => {
    setLoadingSettings(true);
    try {
      const remindersSnap = await getDoc(doc(db, 'systemSettings', 'reminders'));
      const payrollSnap = await getDoc(doc(db, 'systemSettings', 'payroll'));

      let rData: DocumentData = {};
      let pData: DocumentData = {};

      if (remindersSnap.exists()) rData = remindersSnap.data();
      if (payrollSnap.exists()) pData = payrollSnap.data();

      setSystemSettings({
        enable_email_reminders: rData.enable_email_reminders !== false,
        enable_sms_reminders: rData.enable_sms_reminders === true,
        lunch_reminder_time: rData.lunch_reminder_time || '15:00',
        clockout_reminder_time: rData.clockout_reminder_time || '18:00',
        longshift_threshold_hours: rData.longshift_threshold_hours || 10,
        payroll_cycle_type: pData.payroll_cycle_type || 'biweekly',
        weekly_start_day: pData.weekly_start_day ?? 1,
        biweekly_start_date: pData.biweekly_start_date || '2024-01-01',
        locked_up_to_date: pData.locked_up_to_date || '',
      });
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

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, 'systemSettings', 'reminders'), {
        enable_email_reminders: systemSettings.enable_email_reminders,
        enable_sms_reminders: systemSettings.enable_sms_reminders,
        lunch_reminder_time: systemSettings.lunch_reminder_time,
        clockout_reminder_time: systemSettings.clockout_reminder_time,
        longshift_threshold_hours: systemSettings.longshift_threshold_hours,
      }, { merge: true });

      await setDoc(doc(db, 'systemSettings', 'payroll'), {
        payroll_cycle_type: systemSettings.payroll_cycle_type,
        weekly_start_day: systemSettings.weekly_start_day,
        biweekly_start_date: systemSettings.biweekly_start_date,
        locked_up_to_date: systemSettings.locked_up_to_date,
        locked_at: Timestamp.now(),
        locked_by: currentUser.uid,
      }, { merge: true });

      toast.success("Settings saved successfully");
    } catch (e) {
      console.error(e);
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

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
          <CardTitle className="text-slate-800 font-bold">Reminder Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div className="flex items-center space-x-2 border-b pb-4">
            <Checkbox
              id="globalEmail"
              checked={systemSettings.enable_email_reminders}
              onCheckedChange={(checked) => setSystemSettings({ ...systemSettings, enable_email_reminders: !!checked })}
            />
            <Label htmlFor="globalEmail">Enable Email Reminders Globally</Label>
          </div>

          <div className="flex items-center space-x-2 border-b pb-4">
            <Checkbox
              id="globalSMS"
              checked={systemSettings.enable_sms_reminders}
              onCheckedChange={(checked) => setSystemSettings({ ...systemSettings, enable_sms_reminders: !!checked })}
            />
            <Label htmlFor="globalSMS">Enable SMS Reminders Globally</Label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Lunch Reminder Time</Label>
              <Input
                type="time"
                value={systemSettings.lunch_reminder_time}
                onChange={(e) => setSystemSettings({ ...systemSettings, lunch_reminder_time: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">If they haven't logged lunch out. Based on employee timezone.</p>
            </div>
            <div>
              <Label>Clock Out Reminder</Label>
              <Input
                type="time"
                value={systemSettings.clockout_reminder_time}
                onChange={(e) => setSystemSettings({ ...systemSettings, clockout_reminder_time: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">If still clocked in. Based on employee timezone.</p>
            </div>
          </div>

          <div>
            <Label>Long Shift Threshold (Hours)</Label>
            <Input
              type="number"
              min="1"
              max="24"
              value={systemSettings.longshift_threshold_hours}
              onChange={(e) => setSystemSettings({ ...systemSettings, longshift_threshold_hours: parseFloat(e.target.value) || 10 })}
            />
            <p className="text-xs text-slate-400 mt-1">Warn if continuously clocked in over this amount of hours.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border border-white/60 shadow-xl bg-white/70 backdrop-blur-xl rounded-2xl">
        <CardHeader className="bg-white/40 pb-2">
          <CardTitle className="text-slate-800 font-bold">Payroll Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          <div>
            <Label>Payroll Cycle Type</Label>
            <Select
              value={systemSettings.payroll_cycle_type}
              onValueChange={(val) => setSystemSettings({ ...systemSettings, payroll_cycle_type: val })}
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
            <div>
              <Label>Week Start Day</Label>
              <Select
                value={systemSettings.weekly_start_day.toString()}
                onValueChange={(val) => setSystemSettings({ ...systemSettings, weekly_start_day: parseInt(val, 10) })}
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
            <div>
              <Label>Cycle Anchor Date</Label>
              <Input
                type="date"
                value={systemSettings.biweekly_start_date}
                onChange={(e) => setSystemSettings({ ...systemSettings, biweekly_start_date: e.target.value })}
              />
              <p className="text-xs text-slate-400 mt-1">Select any date that marks the start of a bi-weekly cycle.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border border-red-100 shadow-xl bg-white/70 backdrop-blur-xl rounded-2xl">
        <CardHeader className="bg-white/40 pb-2">
          <CardTitle className="text-red-600 font-bold">Lock Payroll Period</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-4">
          <div className="space-y-3 bg-red-50 p-4 border border-red-100 rounded-lg">
            <div>
              <Label className="text-red-900">Lock Entries Up To (Inclusive)</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  type="date"
                  value={systemSettings.locked_up_to_date}
                  onChange={(e) => setSystemSettings({ ...systemSettings, locked_up_to_date: e.target.value })}
                  className="border-red-200"
                />
              </div>
              <p className="text-xs text-red-800 mt-2">
                Setting a date here will prevent any edits or corrections for time entries on or before this date. Clear the date to unlock all periods.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSaveSettings} disabled={saving}>
          {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
          Save Settings
        </Button>
      </div>
    </div>
  );
}
