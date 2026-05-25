import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './popover';
import { Button } from './button';

interface SectionHelpSection {
  title: string;
  content: string;
}

interface SectionHelpProps {
  title: string;
  description?: string;
  /** Optional structured sections shown inside the help popover */
  sections?: SectionHelpSection[];
  /** Alternative: pass children directly as help body */
  children?: React.ReactNode;
}

/**
 * SectionHelp — a small help icon that opens a popover with contextual guidance.
 * Used in admin panels to give inline documentation without cluttering the UI.
 */
export function SectionHelp({ title, description, sections, children }: SectionHelpProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 rounded-full text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
          aria-label={`Help: ${title}`}
        >
          <HelpCircle className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 shadow-lg border border-slate-200 bg-white rounded-xl p-0 overflow-hidden"
        align="end"
        sideOffset={4}
      >
        {/* Header */}
        <div className="bg-indigo-50 border-b border-indigo-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-indigo-900 flex items-center gap-2">
            <HelpCircle className="size-4 text-indigo-500 flex-shrink-0" />
            {title}
          </h3>
        </div>

        {/* Body */}
        <div className="px-4 py-3 space-y-3">
          {description && (
            <p className="text-sm text-slate-600 leading-relaxed">{description}</p>
          )}

          {sections && sections.length > 0 && (
            <div className="space-y-2.5">
              {sections.map((section, i) => (
                <div key={i} className="space-y-0.5">
                  <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    {section.title}
                  </p>
                  <p className="text-xs text-slate-500 leading-relaxed">{section.content}</p>
                </div>
              ))}
            </div>
          )}

          {children && (
            <div className="text-sm text-slate-600">{children}</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
