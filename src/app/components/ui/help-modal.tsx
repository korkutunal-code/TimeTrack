import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './dialog';
import { HelpCircle } from 'lucide-react';

interface HelpModalProps {
  /** Controlled open state */
  open: boolean;
  /** Callback to toggle open state */
  onOpenChange: (open: boolean) => void;
  /** Dialog heading */
  title: string;
  /** Short subtitle/description shown under the title */
  description?: string;
  /** Help content body */
  children?: React.ReactNode;
}

/**
 * HelpModal — a Dialog-based help overlay used in TodayEntry to surface
 * time-tracking guidance to employees without navigating away.
 */
export function HelpModal({
  open,
  onOpenChange,
  title,
  description,
  children,
}: HelpModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-indigo-900">
            <HelpCircle className="size-5 text-indigo-500 flex-shrink-0" />
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-slate-500">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>

        {children && (
          <div className="mt-2 text-sm text-slate-700 leading-relaxed space-y-3">
            {children}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
