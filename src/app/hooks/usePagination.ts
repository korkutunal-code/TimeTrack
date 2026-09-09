import { useMemo, useState } from 'react';

/** Page-size choices offered by the pagination dropdown (default 50). */
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = 50;

/** Total page count for a row set (always >= 1 so the UI shows "Page 1 of 1"). */
export function pageCount(totalItems: number, pageSize: number): number {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

/** Clamp a 1-based page into [1, totalPages]. */
export function clampPage(page: number, totalPages: number): number {
  return Math.min(Math.max(1, page), totalPages);
}

/** Slice a full row array down to the given 1-based page. */
export function slicePage<T>(rows: T[], page: number, pageSize: number): T[] {
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

export interface Pagination {
  /** 1-based current page (already clamped to the available range). */
  currentPage: number;
  pageSize: number;
  totalPages: number;
  setCurrentPage: (page: number) => void;
  /** Change the page size and reset to page 1 (per the spec). */
  setPageSize: (size: number) => void;
  /** Slice a full row array down to the current page. */
  slice: <T>(rows: T[]) => T[];
}

/**
 * Pagination state for a detailed breakdown table.
 *
 * - `currentPage` resets to 1 whenever `pageSize` changes or the underlying
 *   row-set identity changes (`resetKey` — pass the rows array or a filter
 *   string derived from the global date/employee filters). The reset happens
 *   synchronously during render (React's "adjust state during render" pattern)
 *   so the stale page never flashes before the reset.
 * - The page is clamped into [1, totalPages] so shrinking the data (or
 *   growing the page size) never leaves the view stranded on an empty page.
 */
export function usePagination(totalItems: number, resetKey: unknown): Pagination {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSizeState] = useState<number>(DEFAULT_PAGE_SIZE);
  const [prevResetKey, setPrevResetKey] = useState(resetKey);

  const totalPages = pageCount(totalItems, pageSize);

  // Reset to page 1 synchronously when the underlying data/filters change.
  if (resetKey !== prevResetKey) {
    setPrevResetKey(resetKey);
    setCurrentPage(1);
  }

  const setPageSize = (size: number) => {
    setPageSizeState(size);
    setCurrentPage(1);
  };

  const page = clampPage(currentPage, totalPages);

  const slice = useMemo(
    () =>
      <T,>(rows: T[]): T[] =>
        slicePage(rows, page, pageSize),
    [page, pageSize],
  );

  return {
    currentPage: page,
    pageSize,
    totalPages,
    setCurrentPage,
    setPageSize,
    slice,
  };
}
