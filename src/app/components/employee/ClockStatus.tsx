import { Clock, Coffee, LogOut, Calendar, TrendingUp } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import type { TimeSegment } from '../../lib/database';
import { formatHoursHMM } from '../../../utils/timeCalculations';

interface ClockStatusProps {
  isClockedIn: boolean;
  isOnLunch: boolean;
  activeSegment: TimeSegment | null;
  todayTotalMinutes: number;
  currentPTTime: string;
  currentPTDate: string;
}

export function ClockStatus({
  isClockedIn,
  isOnLunch,
  activeSegment,
  todayTotalMinutes,
  currentPTTime,
  currentPTDate,
}: ClockStatusProps) {
  const statusColor = isOnLunch
    ? 'bg-amber-100 text-amber-800 border-amber-300'
    : isClockedIn
    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
    : 'bg-slate-100 text-slate-600 border-slate-300';

  const statusText = isOnLunch
    ? 'ON LUNCH BREAK'
    : isClockedIn
    ? 'CLOCKED IN'
    : 'CLOCKED OUT';

  const since = isOnLunch
    ? activeSegment?.lunchOutManual
    : isClockedIn
    ? activeSegment?.clockInManual
    : null;

  return (
    <Card className="w-full border-2 shadow-sm">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground font-medium">
              {currentPTDate} • America/Los_Angeles
            </div>
            <div className="text-5xl font-mono font-semibold tracking-tighter text-foreground tabular-nums mt-1">
              {currentPTTime}
            </div>
          </div>

          <Badge className={`text-base px-4 py-1 font-semibold border ${statusColor}`}>
            {statusText}
          </Badge>
        </div>

        {since && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>
              Since <span className="font-mono font-medium text-foreground">{since}</span> PT
            </span>
          </div>
        )}

        <div className="pt-2 border-t flex items-baseline justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <TrendingUp className="h-4 w-4" />
            <span className="text-sm">Today so far</span>
          </div>
          <div className="text-3xl font-semibold tabular-nums text-foreground">
            {formatHoursHMM(todayTotalMinutes / 60)}
          </div>
        </div>

        {isOnLunch && (
          <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-sm">
            <Coffee className="h-4 w-4 flex-shrink-0" />
            <span>Lunch break in progress — tap END LUNCH when you return.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
