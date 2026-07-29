import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Clock, Coffee, LogOut, RefreshCw, CalendarDays, AlertTriangle, WifiOff } from 'lucide-react';

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
import { formatHoursHMM, getEmployeeTimezone } from '../../../utils/timeCalculations';

interface ClockPunchProps {
  user: User;
  onViewHistory?: () => void;
  /**
   * Display-only time zone (IANA id). Affects only the on-screen date/time/zone
   * label; never affects calculations or stored timestamps.
   */
  displayTimezone: string;
}

export function ClockPunch({ user, onViewHistory, displayTimezone }: ClockPunchProps) {
  const [status, setStatus] = useState<PunchStatus | null>(null);
  const [week, setWeek] = useState<WeekSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // Employee's persisted local timezone drives entry doc ids, the local
  // midnight split, and per-local-date totals (the local-time-tracking
  // refactor). Falls back to the OS timezone when the profile has none.
  const employeeTz = getEmployeeTimezone(user.timezone);
  // Layer 2: persistent failure banner. A fleeting toast was easy to miss on
  // a flaky mobile connection, leaving the employee believing their clock-out
  // landed when it hadn't (root cause of the stuck open shifts on
  // 06-15/06-24/06-25/07-10). This banner stays visible until the action is
  // retried successfully or dismissed, and exposes a Retry button.
  const [writeFailure, setWriteFailure] = useState<{ action: 'in' | 'out' | 'lunch'; message: string } | null>(null);
  // Synchronous guard against double-click / double-punch race conditions.
  // setState is async in React; a ref check runs synchronously on every call,
  // preventing two punch-in (or punch-out / lunch) calls from being dispatched
  // even when clicks arrive faster than the event loop.
  const punchInFlight = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, w] = await Promise.all([
        getPunchStatus(user.uid, employeeTz),
        getWeekSummary(user.uid, employeeTz),
      ]);
      setStatus(s);
      setWeek(w);
    } catch (e: unknown) {
      toast.error('Failed to load punch status: ' + ((e as Error).message || String(e)));
    } finally {
      setLoading(false);
    }
  }, [user.uid, employeeTz]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // Light refresh every 60s so the live PT time and open-shift estimate stay fresh
    const id = setInterval(load, 60000);
    return () => clearInterval(id);
  }, [load]);

  // Layer 2: notification-only open-shift watchdog. Detects a shift open >16h
  // and prompts the employee to confirm they're still on shift / clock out —
  // WITHOUT writing anything (unlike the legacy TodayEntry 12h auto-closer,
  // which audit item #1 flags as writing capped/incorrect timestamps + no
  // audit). 16h threshold exceeds a normal long day but catches genuinely
  // forgotten clock-outs (the 06-15 shift ran ~5 weeks open). Fires once per
  // open shift per session to avoid nagging.
  const watchdogFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!status?.isClockedIn || !status.activeSegment?.clockInSystem) return;
    const clockInMs = status.activeSegment.clockInSystem;
    const segKey = status.activeSegment.id || String(clockInMs);
    if (watchdogFiredRef.current === segKey) return;
    const elapsedH = (Date.now() - clockInMs) / (60 * 60 * 1000);
    if (elapsedH > 16) {
      watchdogFiredRef.current = segKey;
      toast.warning(
        `You've been clocked in for ${Math.floor(elapsedH)} hours. If you forgot to clock out, tap CLOCK OUT now.`,
        { duration: 10000 },
      );
    }
  }, [status?.isClockedIn, status?.activeSegment?.clockInSystem, status?.activeSegment?.id]);

  const requireOnline = () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      toast.error('You are offline. Connect to the internet before recording a punch.');
      return false;
    }
    return true;
  };

  const doPunchIn = async () => {
    if (!requireOnline()) return;
    if (punchInFlight.current) return;
    punchInFlight.current = true;
    setActionLoading('in');
    try {
      await punchIn(user.uid, undefined, employeeTz);
      setWriteFailure(null);
      toast.success('Clocked in — shift started');
      await load();
    } catch (e: unknown) {
      const msg = (e as Error).message || 'Could not clock in';
      toast.error(msg);
      setWriteFailure({ action: 'in', message: msg });
    } finally {
      punchInFlight.current = false;
      setActionLoading(null);
    }
  };

  const doPunchOut = async () => {
    if (!requireOnline()) return;
    if (punchInFlight.current) return;
    punchInFlight.current = true;
    setActionLoading('out');
    try {
      await punchOut(user.uid, employeeTz);
      setWriteFailure(null);
      toast.success('Clocked out — shift complete');
      await load();
    } catch (e: unknown) {
      const msg = (e as Error).message || 'Could not clock out';
      toast.error(msg);
      setWriteFailure({ action: 'out', message: msg });
    } finally {
      punchInFlight.current = false;
      setActionLoading(null);
    }
  };

  const doToggleLunch = async () => {
    if (!requireOnline()) return;
    if (punchInFlight.current) return;
    punchInFlight.current = true;
    setActionLoading('lunch');
    try {
      const s = status;
      const isEnding = s?.isOnLunch;
      await toggleLunch(user.uid, false, employeeTz);
      setWriteFailure(null);
      toast.success(isEnding ? 'Lunch ended — welcome back' : 'Lunch started');
      await load();
    } catch (e: unknown) {
      const msg = (e as Error).message || 'Lunch action failed';
      toast.error(msg);
      setWriteFailure({ action: 'lunch', message: msg });
    } finally {
      punchInFlight.current = false;
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
  // A lunch break is "used" for this active segment when it was completed
  // (lunchIn set) or skipped. In both cases the segment can't take another
  // lunch, so the button is replaced with a disabled info state.
  const lunchUsed = !!active?.lunchInManual || !!active?.lunchInSystem || !!active?.skipLunch;
  const lunchLabel = onLunch ? 'END LUNCH' : lunchUsed ? 'Lunch break used for this shift' : 'START LUNCH';

  return (
    <div className="space-y-6 max-w-xl mx-auto px-4 pt-3 pb-3">
      {/* Live status header */}
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Punch Clock</h2>
        <p className="text-sm text-muted-foreground">
          One-tap clock in/out
        </p>
      </div>

      {/* Layer 2: persistent write-failure banner. Stays visible until the
          action succeeds on retry or is dismissed — a fleeting toast was the
          root cause of employees believing a lost clock-out had landed. */}
      {writeFailure && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800 shadow-sm"
        >
          <WifiOff className="size-5 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">
              {writeFailure.action === 'out'
                ? 'Clock-out failed — you are still clocked in.'
                : writeFailure.action === 'in'
                  ? 'Clock-in failed — your shift was not started.'
                  : 'Lunch action failed — your shift was not updated.'}
            </p>
            <p className="text-xs text-rose-700 mt-0.5 break-words">
              {writeFailure.message}
            </p>
            <p className="text-xs text-rose-700 mt-0.5">
              Check your connection and retry. Your action was not saved.
            </p>
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (writeFailure.action === 'out') doPunchOut();
                else if (writeFailure.action === 'in') doPunchIn();
                else doToggleLunch();
              }}
              disabled={!!actionLoading}
              className="h-8"
            >
              {actionLoading === writeFailure.action ? (
                <RefreshCw className="size-3.5 mr-1 animate-spin" />
              ) : null}
              Retry
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setWriteFailure(null)}
              className="h-8 text-rose-700 hover:text-rose-900 hover:bg-rose-100"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}

      {/* Big visual status + live clock */}
      {status && (
        <ClockStatus
          isClockedIn={isIn}
          isOnLunch={onLunch}
          activeSegment={active}
          workMinutes={status.workMinutes}
          breakMinutes={status.breakMinutes}
          displayTimezone={displayTimezone}
          statusTimezone={employeeTz}
        />
      )}

      {/* Primary one-tap action */}
      <div className="pt-2">
        <Button
          onClick={primaryAction}
          disabled={!!actionLoading}
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

        {/* Secondary lunch toggle when clocked in. Stays rendered (but
            disabled) when the shift's lunch has already been used, showing
            "Lunch break used for this shift" with no interactive styling. */}
        {isIn && !onLunch && (
          <Button
            onClick={doToggleLunch}
            disabled={lunchUsed || !canDoLunch || !!actionLoading}
            variant="outline"
            className={
              lunchUsed
                ? 'w-full h-12 mt-3 text-base font-medium cursor-not-allowed opacity-60 bg-muted/40 text-muted-foreground'
                : 'w-full h-12 mt-3 text-base font-medium active:scale-[0.985] touch-manipulation'
            }
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
              This Week: Week of {week.weekStart} in America/Los_Angeles
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <div className="text-3xl font-semibold tabular-nums">
                  {formatHoursHMM(week.totalMinutes / 60)}
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
            View Work History
          </Button>
        )}
      </div>

      <p className="text-[10px] text-center text-muted-foreground">
        All times stored in America/Los_Angeles. Lunch uses existing segment model.
      </p>
    </div>
  );
}
