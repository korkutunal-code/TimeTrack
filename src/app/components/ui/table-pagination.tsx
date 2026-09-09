import { ChevronLeft, ChevronRight } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';
import { PAGE_SIZE_OPTIONS, pageCount, clampPage } from '../../hooks/usePagination';

export interface TablePaginationProps {
  /** 1-based current page. */
  currentPage: number;
  /** Rows per page. */
  pageSize: number;
  /** Total number of rows across all pages. */
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

/**
 * Compact pagination control cluster for a detailed-table section header:
 * page-size dropdown ("N per page") + "Page X of Y" status + prev/next
 * buttons. Purely presentational — the caller owns the state (via
 * usePagination) and the row slicing.
 *
 * Renders nothing when every row fits on one page AND the size is still the
 * default (no pagination needed); the size dropdown stays visible once the
 * user has chosen a non-default size so they can switch back.
 */
export function TablePagination({
  currentPage,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: TablePaginationProps) {
  const totalPages = pageCount(totalItems, pageSize);
  const page = clampPage(currentPage, totalPages);
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);

  const btnBase =
    'inline-flex items-center justify-center size-6 rounded border border-slate-300 bg-white text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="flex items-center gap-3">
      {/* Page size */}
      <div className="flex items-center gap-1.5">
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v))}
        >
          <SelectTrigger className="h-7 w-[64px] text-xs px-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)} className="text-xs">
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-slate-500">per page</span>
      </div>

      {/* Page nav */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Previous page"
          className={btnBase}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <span className="text-xs text-slate-600 tabular-nums whitespace-nowrap">
          Page {page} of {totalPages}
          {totalItems > 0 && <span className="text-slate-400"> · {start}-{end} of {totalItems}</span>}
        </span>
        <button
          type="button"
          aria-label="Next page"
          className={btnBase}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
