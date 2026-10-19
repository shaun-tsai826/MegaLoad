/** Page sizes offered on the history page. */
export const PAGE_SIZE_OPTIONS = [5, 10, 20] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 10;

export function isPageSize(value: unknown): value is PageSize {
  return PAGE_SIZE_OPTIONS.includes(value as PageSize);
}

/** Number of pages for `total` items; at least 1 so an empty list still has page 1. */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

/** Clamps a 1-based page number into `[1, pageCount]`. */
export function clampPage(page: number, total: number, size: number): number {
  return Math.min(Math.max(1, Math.floor(page)), pageCount(total, size));
}

/** Items on the 1-based `page`. */
export function paginate<T>(items: readonly T[], page: number, size: number): T[] {
  const p = clampPage(page, items.length, size);
  return items.slice((p - 1) * size, p * size);
}

/** 1-based index range shown on `page`, e.g. `{ from: 11, to: 20 }`; `{0, 0}` when empty. */
export function pageRange(page: number, total: number, size: number): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  const p = clampPage(page, total, size);
  return { from: (p - 1) * size + 1, to: Math.min(p * size, total) };
}

/**
 * Page numbers to show in the pager, with `"…"` for gaps, e.g.
 * `[1, "…", 4, 5, 6, "…", 12]`. Always includes the first, last and current
 * page plus one neighbour on each side.
 */
export function pageWindow(current: number, total: number): (number | "…")[] {
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (typeof prev === "number" && p - prev === 2) out.push(prev + 1);
    else if (typeof prev === "number" && p - prev > 2) out.push("…");
    out.push(p);
  }
  return out;
}
