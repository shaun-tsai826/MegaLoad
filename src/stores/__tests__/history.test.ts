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
  setActivePinia(createPinia());
  mockInvoke.mockReset();
});

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
