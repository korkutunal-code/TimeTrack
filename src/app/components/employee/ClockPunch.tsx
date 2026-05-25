import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Clock, Coffee, LogOut, RefreshCw, CalendarDays, AlertTriangle } from 'lucide-react';

import type { User } from '../../lib/auth';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ClockStatus } from './ClockStatus';
import {
  getPunchStatus,
  punchIn,
  punchOut,
  toggleLunch,
  getWeekSummary,
  type PunchStatus,
  type WeekSummary,
} from '../../../services/clockService';
import { formatHoursHMM } from '../../../utils/timeCalculations';

interface ClockPunchProps {
  user: User;
  onViewHistory?: () => void;
}

export function ClockPunch({ user, onViewHistory }: ClockPunchProps) {
  const [status, setStatus] = useState<PunchStatus | null>(null);
  const [week, setWeek] = useState<WeekSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, w] = await Promise.all([
        getPunchStatus(user.uid),
        getWeekSummary(user.uid),
      ]);
      setStatus(s);
      setWeek(w);
    } catch (e: any) {
      toast.error('Failed to load punch status: ' + (e.message || e));
    } finally {
      setLoading(false);
    }
  }, [user.uid]);

  useEffect(() => {
    load();
    // Light refresh every 60s so the live PT time and open-shift estimate stay fresh
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  const doPunchIn = async () => {
    setActionLoading('in');
    try {
      await punchIn(user.uid);
      toast.success('Clocked in — shift started');
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Could not clock in');
    } finally {
      setActionLoading(null);
    }
  };

  const doPunchOut = async () => {
    setActionLoading('out');
    try {
      await punchOut(user.uid);
      toast.success('Clocked out — shift complete');
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Could not clock out');
    } finally {
      setActionLoading(null);
    }
  };

  const doToggleLunch = async () => {
    setActionLoading('lunch');
    try {
      const s = status;
      const isEnding = s?.isOnLunch;
      await toggleLunch(user.uid);
      toast.success(isEnding ? 'Lunch ended — welcome back' : 'Lunch started');
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Lunch action failed');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isIn = status?.isClockedIn ?? false;
  const onLunch = status?.isOnLunch ?? false;
  const active = status?.activeSegment ?? null;

  // Primary action label + icon (one big tap target)
  let primaryLabel = 'CLOCK IN';
  let primaryIcon = <Clock className="h-5 w-5 mr-2" />;
  let primaryAction = doPunchIn;
  let primaryVariant: 'default' | 'destructive' | 'secondary' = 'default';

  if (isIn && !onLunch) {
    primaryLabel = 'CLOCK OUT';
    primaryIcon = <LogOut className="h-5 w-5 mr-2" />;
    primaryAction = doPunchOut;
    primaryVariant = 'destructive';
  } else if (isIn && onLunch) {
    primaryLabel = 'END LUNCH';
    primaryIcon = <Coffee className="h-5 w-5 mr-2" />;
    primaryAction = doToggleLunch;
    primaryVariant = 'default';
  }

  const canDoLunch = isIn && !active?.complete;
  const lunchLabel = onLunch ? 'END LUNCH' : 'START LUNCH';

  return (
    <div className="space-y-6 max-w-xl mx-auto px-4 py-6">
      {/* Live status header */}
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Punch Clock</h2>
        <p className="text-sm text-muted-foreground">
          One-tap clock in/out • America/Los_Angeles
        </p>
      </div>

      {/* Big visual status + live PT clock */}
      {status && (
        <ClockStatus
          isClockedIn={isIn}
          isOnLunch={onLunch}
          activeSegment={active}
          todayTotalMinutes={status.todayTotalMinutes}
          currentPTTime={status.currentPTTime}
          currentPTDate={status.currentPTDate}
        />
      )}

      {/* Primary one-tap action */}
      <div className="pt-2">
        <Button
          onClick={primaryAction}
          disabled={!!actionLoading || loading}
          variant={primaryVariant}
          className="w-full h-16 text-xl font-semibold active:scale-[0.985] transition-all touch-manipulation"
          size="lg"
        >
          {actionLoading === (isIn ? 'out' : 'in') ? (
            <RefreshCw className="h-5 w-5 mr-2 animate-spin" />
          ) : (
            primaryIcon
          )}
          {primaryLabel}
        </Button>

        {/* Secondary lunch toggle when clocked in */}
        {isIn && !onLunch && (
          <Button
            onClick={doToggleLunch}
            disabled={!canDoLunch || !!actionLoading}
            variant="outline"
            className="w-full h-12 mt-3 text-base font-medium active:scale-[0.985] touch-manipulation"
          >
            {actionLoading === 'lunch' ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Coffee className="h-4 w-4 mr-2" />
            )}
            {lunchLabel}
          </Button>
        )}
      </div>

      {/* Guard message for double-punch attempts */}
      {!isIn && status?.entry && (
        <div className="text-xs text-center text-muted-foreground flex items-center justify-center gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5" />
          One open shift per day maximum. Previous shifts are archived automatically.
        </div>
      )}

      {/* This Week summary (simple, always visible, employee-friendly) */}
      {week && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              This Week (PT)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <div className="text-3xl font-semibold tabular-nums">
                  {formatHoursHMM(week.totalMinutes)}
                </div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Total Hours
                </div>
              </div>
              <div>
                <div className="text-3xl font-semibold tabular-nums">{week.daysWorked}</div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Days Worked
                </div>
              </div>
            </div>
            <div className="text-[10px] text-center text-muted-foreground mt-3">
              Week of {week.weekStart}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Footer actions */}
      <div className="flex gap-3 pt-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={load}
          disabled={loading || !!actionLoading}
          className="flex-1"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
        {onViewHistory && (
          <Button variant="outline" size="sm" onClick={onViewHistory} className="flex-1">
            View Full History
          </Button>
        )}
      </div>

      <p className="text-[10px] text-center text-muted-foreground">
        All times stored in America/Los_Angeles. Lunch uses existing segment model.
      </p>
    </div>
  );
}
