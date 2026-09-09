/**
 * Unit tests for the pure pagination math backing the Daily Breakdown
 * pagination controls (Payroll + Analytics). The hook is a thin stateful
 * wrapper; all slicing/clamping/counting lives in these pure functions.
 */
import {
  pageCount,
  clampPage,
  slicePage,
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
} from './usePagination';

describe('pagination config', () => {
  it('defaults to 50 per page and offers 25/50/100/200', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(50);
    expect([...PAGE_SIZE_OPTIONS]).toEqual([25, 50, 100, 200]);
  });
});

describe('pageCount', () => {
  it('computes the number of pages', () => {
    expect(pageCount(120, 50)).toBe(3);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
  });

  it('never returns less than 1 (empty set still shows "Page 1 of 1")', () => {
    expect(pageCount(0, 50)).toBe(1);
  });
});

describe('clampPage', () => {
  it('clamps into [1, totalPages]', () => {
    expect(clampPage(1, 3)).toBe(1);
    expect(clampPage(3, 3)).toBe(3);
    expect(clampPage(0, 3)).toBe(1);   // below range
    expect(clampPage(99, 3)).toBe(3);  // above range (e.g. data shrank)
  });
});

describe('slicePage', () => {
  const rows = Array.from({ length: 120 }, (_, i) => i + 1); // 1..120

  it('returns the first page by default slice bounds', () => {
    expect(slicePage(rows, 1, 50)).toHaveLength(50);
    expect(slicePage(rows, 1, 50)[0]).toBe(1);
    expect(slicePage(rows, 1, 50)[49]).toBe(50);
  });

  it('slices page 2 correctly (rows 51-100)', () => {
    const p2 = slicePage(rows, 2, 50);
    expect(p2[0]).toBe(51);
    expect(p2[49]).toBe(100);
  });

  it('returns a short final page (101-120)', () => {
    const p3 = slicePage(rows, 3, 50);
    expect(p3).toHaveLength(20);
    expect(p3[0]).toBe(101);
  });

  it('respects a smaller page size (25)', () => {
    expect(slicePage(rows, 1, 25)).toHaveLength(25);
    expect(slicePage(rows, 2, 25)[0]).toBe(26);
  });
});
