import { describe, expect, it } from "vitest";
import fc from "fast-check";

import {
  PAGE_SIZE_OPTIONS,
  clampPage,
  isPageSize,
  pageCount,
  pageRange,
  pageWindow,
  paginate,
} from "../pagination";

describe("pageCount / clampPage", () => {
  it("has at least one page", () => {
    expect(pageCount(0, 10)).toBe(1);
    expect(pageCount(10, 10)).toBe(1);
    expect(pageCount(11, 10)).toBe(2);
  });

  it("clamps out-of-range pages", () => {
    expect(clampPage(0, 25, 10)).toBe(1);
    expect(clampPage(9, 25, 10)).toBe(3);
    expect(clampPage(2, 0, 10)).toBe(1);
  });
});

describe("pageRange", () => {
  it("reports the shown items", () => {
    expect(pageRange(2, 35, 10)).toEqual({ from: 11, to: 20 });
    expect(pageRange(4, 35, 10)).toEqual({ from: 31, to: 35 });
    expect(pageRange(1, 0, 10)).toEqual({ from: 0, to: 0 });
  });
});

describe("pageWindow", () => {
  it("lists every page when there are few", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it("collapses gaps with an ellipsis", () => {
    expect(pageWindow(5, 12)).toEqual([1, "…", 4, 5, 6, "…", 12]);
    expect(pageWindow(1, 12)).toEqual([1, 2, "…", 12]);
    expect(pageWindow(12, 12)).toEqual([1, "…", 11, 12]);
  });

  it("fills a single missing page instead of an ellipsis", () => {
    expect(pageWindow(4, 12)).toEqual([1, 2, 3, 4, 5, "…", 12]);
  });

  it("always includes first, last and current, in order", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), fc.nat(), (total, c) => {
        const current = (c % total) + 1;
        const w = pageWindow(current, total);
        const nums = w.filter((x): x is number => typeof x === "number");
        expect(nums).toContain(1);
        expect(nums).toContain(total);
        expect(nums).toContain(current);
        expect(nums).toEqual([...nums].sort((a, b) => a - b));
        expect(new Set(nums).size).toBe(nums.length);
        // An ellipsis never sits at either end or next to another one.
        expect(w[0]).not.toBe("…");
        expect(w[w.length - 1]).not.toBe("…");
        w.forEach((x, i) => {
          if (x === "…") expect(w[i + 1]).not.toBe("…");
        });
      }),
    );
  });
});

describe("paginate", () => {
  it("returns the items of the requested page", () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    expect(paginate(items, 1, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(paginate(items, 3, 10)).toEqual([20, 21, 22]);
    expect(paginate(items, 99, 10)).toEqual([20, 21, 22]);
  });

  it("pages cover every item exactly once, in order, within the page size", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 120 }),
        fc.constantFrom(...PAGE_SIZE_OPTIONS),
        (items, size) => {
          const pages = Array.from({ length: pageCount(items.length, size) }, (_, i) =>
            paginate(items, i + 1, size),
          );
          pages.forEach((p) => expect(p.length).toBeLessThanOrEqual(size));
          expect(pages.flat()).toEqual(items);
        },
      ),
    );
  });
});

describe("isPageSize", () => {
  it("accepts only the offered sizes", () => {
    expect(isPageSize(10)).toBe(true);
    expect(isPageSize(15)).toBe(false);
    expect(isPageSize("10")).toBe(false);
  });
});
