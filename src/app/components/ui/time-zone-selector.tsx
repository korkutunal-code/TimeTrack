import { Globe } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
 */
export function TimeZoneSelector({ value, onChange }: TimeZoneSelectorProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        aria-label="Display time zone"
        size="sm"
        className="h-9 md:h-10 w-[180px] sm:w-[230px] rounded-full border-slate-200 bg-white/50 text-slate-700 hover:bg-white hover:text-slate-900 text-xs md:text-sm font-medium shadow-sm"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Globe className="size-3.5 md:size-4 shrink-0 text-indigo-500" />
          <SelectValue placeholder="Select time zone" />
        </span>
      </SelectTrigger>
      <SelectContent className="max-h-80">
        {DISPLAY_TIMEZONES.map((tz) => (
          <SelectItem key={tz.id} value={tz.id}>
            {tz.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
