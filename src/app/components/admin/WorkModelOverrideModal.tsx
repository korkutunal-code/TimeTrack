import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '../ui/dialog';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import { Switch } from '../ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Button } from '../ui/button';
import { toast } from 'sonner';
import { Loader2, Sliders, AlertCircle } from 'lucide-react';
import { User, WorkModelOverride } from '../../lib/auth';
import { dbService } from '../../lib/database';
import { listWorkModels, type WorkModel } from '../../../services/workModelsService';

interface WorkModelOverrideModalProps {
  user: User | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUserUpdated: (user: User) => void;
}

const EMPTY_OVERRIDE: WorkModelOverride = {
  hasCustomRules: true,
  noOvertime: false,
  overtimeLimit: 8,
  overtimeMultiplier: 1.5,
  doubleTimeLimit: 12,
  doubleTimeMultiplier: 2.0,
  weeklyOvertimeLimit: 40,
};

export function WorkModelOverrideModal({ user, open, onOpenChange, onUserUpdated }: WorkModelOverrideModalProps) {
  const [models, setModels] = useState<WorkModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [workModelId, setWorkModelId] = useState<string>('');
  const [hasCustomRules, setHasCustomRules] = useState(false);
  const [override, setOverride] = useState<WorkModelOverride>(EMPTY_OVERRIDE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoadingModels(true);
    listWorkModels()
      .then(list => {
        setModels(list);
        if (user) {
          setWorkModelId(user.workModelId || '');
          const existing = user.workModelOverride;
          if (existing && existing.hasCustomRules) {
            setHasCustomRules(true);
            setOverride({ ...EMPTY_OVERRIDE, ...existing });
          } else {
            setHasCustomRules(false);
            setOverride(EMPTY_OVERRIDE);
          }
        }
      })
      .catch(e => {
        console.error(e);
        toast.error('Failed to load work models');
      })
      .finally(() => setLoadingModels(false));
  }, [open, user]);

  const updateOverride = (patch: Partial<WorkModelOverride>) => {
    setOverride(prev => ({ ...prev, ...patch }));
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const patch: { workModelId: string; workModelOverride: WorkModelOverride | null } = {
        workModelId,
        workModelOverride: hasCustomRules
          ? { ...override, hasCustomRules: true }
          : { hasCustomRules: false },
      };
      const updated = await dbService.updateUser(user.uid, patch);
      onUserUpdated(updated);
      toast.success('Work model settings saved');
      onOpenChange(false);
    } catch (e) {
      console.error(e);
      toast.error('Failed to save work model settings');
    } finally {
      setSaving(false);
    }
  };

  const selectedModel = models.find(m => m.id === workModelId);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-800">
            <Sliders className="size-5 text-indigo-500" />
            Work Model & Overtime — {user?.name}
          </DialogTitle>
          <DialogDescription>
            Assign a base work model and optionally override overtime rules for this user.
          </DialogDescription>
        </DialogHeader>

        {loadingModels ? (
          <div className="py-8 text-center text-sm text-slate-500">Loading work models...</div>
        ) : (
          <div className="space-y-5">
            <div>
              <Label>Base Work Model</Label>
              <Select value={workModelId} onValueChange={setWorkModelId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a work model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map(m => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedModel && (
                <p className="text-xs text-slate-400 mt-1">
                  {selectedModel.noOvertime
                    ? 'Base model has overtime disabled.'
                    : `Base: OT after ${selectedModel.overtimeLimit}h (${selectedModel.overtimeMultiplier}×) · DT after ${selectedModel.doubleTimeLimit}h (${selectedModel.doubleTimeMultiplier}×) · Weekly cap ${selectedModel.weeklyOvertimeLimit}h`}
                </p>
              )}
            </div>

            <div className="border-t pt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="customRules">Enable Custom Overtime Overrides for this user</Label>
                  <p className="text-xs text-slate-400 mt-0.5">Override the base work model's rules with user-specific values.</p>
                </div>
                <Switch
                  id="customRules"
                  checked={hasCustomRules}
                  onCheckedChange={setHasCustomRules}
                />
              </div>
            </div>

            {hasCustomRules && (
              <>
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <Checkbox
                    id="overrideNoOvertime"
                    checked={!!override.noOvertime}
                    onCheckedChange={(c) => updateOverride({ noOvertime: !!c })}
                  />
                  <Label htmlFor="overrideNoOvertime" className="text-amber-900">No Overtime (exempt this user from OT/DT)</Label>
                </div>

                <fieldset disabled={!!override.noOvertime} className={override.noOvertime ? 'opacity-40 pointer-events-none' : ''}>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <Label>Weekly Overtime Cap (Hours)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.5"
                        value={override.weeklyOvertimeLimit ?? 40}
                        onChange={(e) => updateOverride({ weeklyOvertimeLimit: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div>
                      <Label>Daily Overtime Threshold (hours)</Label>
                      <Input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={override.overtimeLimit ?? 8}
                        onChange={(e) => updateOverride({ overtimeLimit: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div>
                      <Label>Overtime Multiplier</Label>
                      <Input
                        type="number"
                        min="1"
                        step="0.1"
                        value={override.overtimeMultiplier ?? 1.5}
                        onChange={(e) => updateOverride({ overtimeMultiplier: parseFloat(e.target.value) || 1 })}
                      />
                    </div>
                    <div>
                      <Label>Double Time Threshold (hours)</Label>
                      <Input
                        type="number"
                        min="0"
                        max="24"
                        step="0.5"
                        value={override.doubleTimeLimit ?? 12}
                        onChange={(e) => updateOverride({ doubleTimeLimit: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div>
                      <Label>Double Time Multiplier</Label>
                      <Input
                        type="number"
                        min="1"
                        step="0.1"
                        value={override.doubleTimeMultiplier ?? 2.0}
                        onChange={(e) => updateOverride({ doubleTimeMultiplier: parseFloat(e.target.value) || 1 })}
                      />
                    </div>
                  </div>
                </fieldset>

                {!workModelId && (
                  <p className="text-xs text-amber-600 flex items-center gap-1.5">
                    <AlertCircle className="size-3.5" />
                    No base work model selected — overrides will apply but inheritance falls back to defaults.
                  </p>
                )}
              </>
            )}

            {hasCustomRules === false && workModelId && (
              <p className="text-xs text-slate-500">
                This user will inherit all overtime rules from their assigned base work model.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || loadingModels}>
            {saving ? <Loader2 className="size-4 mr-2 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
