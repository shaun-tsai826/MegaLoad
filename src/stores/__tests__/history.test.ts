import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import fc from "fast-check";

import type { HistoryRecord } from "@/types";
import { QUALITY_PRIORITY } from "@/utils/quality";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { useDownloadTaskStore } from "../downloadTask";
import { useHistoryStore } from "../history";

const mockInvoke = vi.mocked(invoke);

function record(id: string, overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id,
    url: "https://e/v",
    title: `t-${id}`,
    thumbnail: "",
    quality: "720p",
    outputPath: "/out",
    filePath: null,
    status: "failed",
    errorMessage: "x",
    createdAt: "2026-10-16T00:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  setActivePinia(createPinia());
  mockInvoke.mockReset();
});

/** `n` records with ids "0".."n-1", newest first. */
function many(n: number): HistoryRecord[] {
  return Array.from({ length: n }, (_, i) => record(String(i)));
}

describe("useHistoryStore", () => {
  it("loads records from the backend", async () => {
    mockInvoke.mockResolvedValueOnce([record("a"), record("b")]);
    const store = useHistoryStore();
    const loading = store.loadHistory();
    expect(store.isLoading).toBe(true);
    await loading;
    expect(mockInvoke).toHaveBeenCalledWith("get_history");
    expect(store.records.map((r) => r.id)).toEqual(["a", "b"]);
    expect(store.isLoading).toBe(false);
  });

  it("keeps the list when deleting fails", async () => {
    const store = useHistoryStore();
    store.records = [record("a")];
    mockInvoke.mockRejectedValueOnce({ type: "IoError", message: "disk full" });
    await expect(store.deleteRecord("a")).rejects.toEqual({ type: "IoError", message: "disk full" });
    expect(store.records).toHaveLength(1);
  });

  it("clears all records", async () => {
    const store = useHistoryStore();
    store.records = [record("a"), record("b")];
    await store.clearAll();
    expect(mockInvoke).toHaveBeenCalledWith("clear_all_history");
    expect(store.records).toEqual([]);
  });

  it("appendRecord puts new records first and replaces duplicates", () => {
    const store = useHistoryStore();
    store.appendRecord(record("a"));
    store.appendRecord(record("b"));
    store.appendRecord(record("a", { status: "completed" }));
    expect(store.records.map((r) => [r.id, r.status])).toEqual([
      ["a", "completed"],
      ["b", "failed"],
    ]);
  });
});

// Property 11: 歷史記錄刪除隔離性（Validates: Requirements 6.4）
describe("Property 11: deleting one record leaves the others untouched", () => {
  it("holds for any list and any index", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.uuid(), { minLength: 1, maxLength: 20 }),
        fc.nat(),
        async (ids, pick) => {
          setActivePinia(createPinia());
          mockInvoke.mockResolvedValue(undefined);
          const store = useHistoryStore();
          store.records = ids.map((id) => record(id));
          const before = store.records.map((r) => ({ ...r }));
          const target = ids[pick % ids.length];

          await store.deleteRecord(target);

          expect(mockInvoke).toHaveBeenLastCalledWith("delete_history_item", { id: target });
          expect(store.records).toHaveLength(ids.length - 1);
          expect(store.records.some((r) => r.id === target)).toBe(false);
          expect(store.records).toEqual(before.filter((r) => r.id !== target));
        },
      ),
    );
  });
});

// Property 10: 重試任務參數不變性（Validates: Requirements 6.3, 7.3）
describe("Property 10: retry keeps url, quality and outputPath", () => {
  it("holds for any failed or cancelled record", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.webUrl(),
        fc.constantFrom(...QUALITY_PRIORITY),
        fc.string(),
        fc.constantFrom<HistoryRecord["status"][]>("failed", "cancelled"),
        async (url, quality, outputPath, status) => {
          setActivePinia(createPinia());
          mockInvoke.mockResolvedValue("new-task");
          const history = useHistoryStore();
          const r = record("old", { url, quality, outputPath, status });

          const id = await history.retryDownload(r);

          expect(useDownloadTaskStore().tasks.get(id)).toMatchObject({ url, quality, outputPath, status: "pending" });
        },
      ),
    );
  });
});

describe("redownload", () => {
  it("restarts with the original parameters, overwriting only when asked", async () => {
    mockInvoke.mockResolvedValue("new-task");
    const store = useHistoryStore();
    const r = record("done", { status: "completed", filePath: "/out/a [1280x720].mp4" });

    await store.redownload(r);
    expect(mockInvoke).toHaveBeenLastCalledWith("start_download", {
      url: "https://e/v",
      quality: "720p",
      outputPath: "/out",
      title: "t-done",
      thumbnail: "",
    });

    await store.redownload(r, { overwrite: true });
    expect(mockInvoke).toHaveBeenLastCalledWith("start_download", expect.objectContaining({ overwrite: true }));
    expect(useDownloadTaskStore().tasks.get("new-task")?.status).toBe("pending");
  });

  it("checks whether the file is still on disk", async () => {
    const store = useHistoryStore();
    mockInvoke.mockResolvedValueOnce(true);
    expect(await store.fileExists(record("a", { filePath: "/out/a.mp4" }))).toBe(true);
    expect(mockInvoke).toHaveBeenCalledWith("file_exists", { path: "/out/a.mp4" });

    mockInvoke.mockClear();
    expect(await store.fileExists(record("b", { filePath: null }))).toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("pagination", () => {
  it("shows 10 per page by default", () => {
    const store = useHistoryStore();
    store.records = many(23);
    expect(store.pageSize).toBe(10);
    expect(store.totalPages).toBe(3);
    expect(store.pagedRecords.map((r) => r.id)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    store.setPage(3);
    expect(store.pagedRecords.map((r) => r.id)).toEqual(["20", "21", "22"]);
    expect(store.pageRange).toEqual({ from: 21, to: 23 });
  });

  it("clamps out-of-range pages", () => {
    const store = useHistoryStore();
    store.records = many(23);
    store.setPage(99);
    expect(store.currentPage).toBe(3);
    store.setPage(0);
    expect(store.currentPage).toBe(1);
  });

  it("changing the page size keeps the first visible record on screen", () => {
    const store = useHistoryStore();
    store.records = many(23);
    store.setPage(3); // records 20-22
    store.setPageSize(5);
    expect(store.currentPage).toBe(5); // records 20-22 at size 5
    expect(store.pagedRecords[0].id).toBe("20");
    store.setPageSize(20);
    expect(store.currentPage).toBe(2);
    expect(store.pagedRecords[0].id).toBe("20");
  });

  it("remembers the page size", () => {
    useHistoryStore().setPageSize(20);
    setActivePinia(createPinia());
    expect(useHistoryStore().pageSize).toBe(20);
  });

  it("ignores an invalid saved page size", () => {
    localStorage.setItem("megaload.history.pageSize", "15");
    expect(useHistoryStore().pageSize).toBe(10);
  });

  it("moves back a page when deleting empties the current one", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const store = useHistoryStore();
    store.records = many(11);
    store.setPage(2); // only record "10"
    await store.deleteRecord("10");
    expect(store.totalPages).toBe(1);
    expect(store.currentPage).toBe(1);
    expect(store.pagedRecords).toHaveLength(10);
  });

  it("clearAll goes back to page 1", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const store = useHistoryStore();
    store.records = many(30);
    store.setPage(3);
    await store.clearAll();
    expect(store.currentPage).toBe(1);
    expect(store.pagedRecords).toEqual([]);
  });
});
