import { Globe } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from './select';
import { DISPLAY_TIMEZONES } from '../../lib/timezones';

interface TimeZoneSelectorProps {
  value: string;
  onChange: (tz: string) => void;
}

/**
 * Display-only time zone selector for the header. Manual selection only —
 * no auto/browser-detect option. Changing the value only affects how the
 * date/time/zone label is displayed on screen; it does not touch backend
 * data or calculations.
 *
 * The collapsed trigger shows ONLY the UTC offset (e.g. "UTC-08:00") to keep
 * it narrow next to the avatar. The expanded popover is widened so the full
 * city/region list stays readable.
 */
export function TimeZoneSelector({ value, onChange }: TimeZoneSelectorProps) {
  const selected = DISPLAY_TIMEZONES.find((tz) => tz.id === value);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Display time zone"
        size="sm"
        className="h-9 md:h-10 w-[150px] sm:w-[160px] rounded-full border-slate-200 bg-white/50 text-slate-700 hover:bg-white hover:text-slate-900 text-xs md:text-sm font-medium shadow-sm px-3 md:px-4"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Globe className="size-3.5 md:size-4 shrink-0 text-indigo-500" />
          <span className="tabular-nums truncate">
            {selected?.offset ?? 'UTC'}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent className="w-[340px] max-w-[90vw]" position="popper" sideOffset={8}>
        {DISPLAY_TIMEZONES.map((tz) => (
          <SelectItem key={tz.id} value={tz.id}>
            <span className="tabular-nums font-medium">{tz.offset}</span>{' '}
            <span className="text-muted-foreground">{tz.label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
