import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import fc from "fast-check";

import type { AppErrorType, DownloadProgressEvent, DownloadTask } from "@/types";
import { QUALITY_PRIORITY } from "@/utils/quality";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { toHistoryRecord, useDownloadTaskStore } from "../downloadTask";

const mockInvoke = vi.mocked(invoke);
const META = { title: "Zoo", thumbnail: "https://i/t.jpg" };
let nextId = 0;

beforeEach(() => {
  setActivePinia(createPinia());
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd) =>
    cmd === "start_download" ? `task-${++nextId}` : undefined,
  );
});

async function startOne(store = useDownloadTaskStore()) {
  const id = await store.startDownload("https://e/v", "720p", "/out", META);
  return { store, id, task: () => store.tasks.get(id)! };
}

function progress(taskId: string, n: number): DownloadProgressEvent {
  return { taskId, percent: n, speed: `${n}MiB/s`, speedBytes: n * 1024, eta: "00:01", etaSeconds: n };
}

describe("startDownload", () => {
  it("passes metadata to the backend and adds a pending task", async () => {
    const { id, task } = await startOne();
    expect(mockInvoke).toHaveBeenCalledWith("start_download", {
      url: "https://e/v",
      quality: "720p",
      outputPath: "/out",
      title: "Zoo",
      thumbnail: "https://i/t.jpg",
    });
    expect(task()).toMatchObject({ id, status: "pending", percent: 0, title: "Zoo" });
  });

  it("rejects with an AppError and adds nothing when the backend fails", async () => {
    const store = useDownloadTaskStore();
    mockInvoke.mockRejectedValueOnce({ type: "YtDlpError", message: "spawn failed" });
    await expect(store.startDownload("https://e/v", "720p", "/out", META)).rejects.toEqual({
      type: "YtDlpError",
      message: "spawn failed",
    });
    expect(store.tasks.size).toBe(0);
  });
});

describe("events", () => {
  it("completes a task", async () => {
    const { store, id, task } = await startOne();
    store.updateProgress(progress(id, 40));
    expect(store.activeCount).toBe(1);
    const t = store.markCompleted({ taskId: id, filePath: "/out/Zoo.mp4", title: "Zoo", completedAt: "T" });
    expect(t).toBe(task());
    expect(task()).toMatchObject({ status: "completed", percent: 100, filePath: "/out/Zoo.mp4", completedAt: "T" });
    expect(store.activeCount).toBe(0);
  });

  it("marks cancellation as cancelled, not failed", async () => {
    const { store, id, task } = await startOne();
    store.markCancelled({ taskId: id });
    expect(task().status).toBe("cancelled");
    expect(task().errorMessage).toBeNull();
  });

  it("ignores progress after a task finished", async () => {
    const { store, id, task } = await startOne();
    store.markCancelled({ taskId: id });
    store.updateProgress(progress(id, 50));
    expect(task().status).toBe("cancelled");
    expect(task().percent).toBe(0);
  });

  it("ignores events for unknown tasks", async () => {
    const store = useDownloadTaskStore();
    store.updateProgress(progress("nope", 1));
    expect(store.markCompleted({ taskId: "nope", filePath: "", title: "", completedAt: "" })).toBeUndefined();
    expect(store.tasks.size).toBe(0);
  });

  it("cancelTask only asks the backend", async () => {
    const { store, id, task } = await startOne();
    await store.cancelTask(id);
    expect(mockInvoke).toHaveBeenLastCalledWith("cancel_download", { taskId: id });
    expect(task().status).toBe("pending");
  });
});

describe("retryTask", () => {
  it("restarts with the original parameters and replaces the card", async () => {
    const { store, id } = await startOne();
    store.markFailed({ taskId: id, errorType: "NetworkError", message: "x" });
    const newId = await store.retryTask(id);
    expect(mockInvoke).toHaveBeenLastCalledWith("start_download", {
      url: "https://e/v",
      quality: "720p",
      outputPath: "/out",
      title: "Zoo",
      thumbnail: "https://i/t.jpg",
    });
    expect(store.tasks.has(id)).toBe(false);
    expect(store.tasks.get(newId!)?.status).toBe("pending");
  });
});

describe("taskList", () => {
  it("is sorted newest first", async () => {
    const store = useDownloadTaskStore();
    const { id: a } = await startOne(store);
    const { id: b } = await startOne(store);
    store.tasks.get(a)!.createdAt = "2026-01-01T00:00:00Z";
    store.tasks.get(b)!.createdAt = "2026-01-02T00:00:00Z";
    expect(store.taskList.map((t) => t.id)).toEqual([b, a]);
  });
});

describe("toHistoryRecord", () => {
  it("returns null for unfinished tasks", async () => {
    const { task } = await startOne();
    expect(toHistoryRecord(task())).toBeNull();
  });

  it("only keeps completedAt for completed tasks", async () => {
    const { store, id, task } = await startOne();
    store.markFailed({ taskId: id, errorType: "NetworkError", message: "x" });
    expect(toHistoryRecord(task())).toMatchObject({ id, status: "failed", errorMessage: "x", completedAt: null });
  });
});

/** Snapshot of the fields an event must not touch on other tasks. */
function snapshot(task: DownloadTask) {
  return { ...task };
}

// Property 8: 進度事件驅動 Store 狀態一致性（Validates: Requirements 4.5）
describe("Property 8: progress events update only their task", () => {
  it("holds for any progress values", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        fc.nat(),
        fc.record({
          percent: fc.double({ min: 0, max: 100, noNaN: true }),
          speed: fc.string(),
          speedBytes: fc.nat(),
          eta: fc.string(),
          etaSeconds: fc.nat(),
        }),
        async (count, pick, values) => {
          setActivePinia(createPinia());
          const store = useDownloadTaskStore();
          const ids: string[] = [];
          for (let i = 0; i < count; i++) ids.push((await startOne(store)).id);
          const target = ids[pick % count];
          const others = ids.filter((id) => id !== target).map((id) => snapshot(store.tasks.get(id)!));

          store.updateProgress({ taskId: target, ...values });

          expect(store.tasks.get(target)).toMatchObject({
            percent: values.percent,
            speed: values.speed,
            speedBytes: values.speedBytes,
            etaSeconds: values.etaSeconds,
            status: "downloading",
          });
          for (const before of others) expect(store.tasks.get(before.id)).toEqual(before);
        },
      ),
    );
  });
});

// Property 12: 下載失敗狀態轉換正確性（Validates: Requirements 7.1, 7.2）
describe("Property 12: failed events fail only their task", () => {
  it("holds for any error message", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 5 }),
        fc.nat(),
        fc.string(),
        fc.constantFrom<AppErrorType[]>("AuthRequired", "YtDlpError", "NetworkError", "IoError", "Unknown"),
        async (count, pick, message, errorType) => {
          setActivePinia(createPinia());
          const store = useDownloadTaskStore();
          const ids: string[] = [];
          for (let i = 0; i < count; i++) {
            const { id } = await startOne(store);
            store.updateProgress(progress(id, 10));
            ids.push(id);
          }
          const target = ids[pick % count];
          const others = ids.filter((id) => id !== target).map((id) => snapshot(store.tasks.get(id)!));

          store.markFailed({ taskId: target, errorType, message });

          const failed = store.tasks.get(target)!;
          expect(failed.status).toBe("failed");
          expect(failed.errorMessage).toBeTruthy();
          for (const before of others) expect(store.tasks.get(before.id)).toEqual(before);
        },
      ),
    );
  });
});

// Property 6: Download Task 建立不可變性（Validates: Requirements 4.1, 4.2）
describe("Property 6: created tasks keep their parameters", () => {
  it("holds for any url, quality and path", async () => {
    await fc.assert(
      fc.asyncProperty(fc.webUrl(), fc.constantFrom(...QUALITY_PRIORITY), fc.string(), async (url, quality, outputPath) => {
        setActivePinia(createPinia());
        const store = useDownloadTaskStore();
        const a = await store.startDownload(url, quality, outputPath, META);
        const b = await store.startDownload(url, quality, outputPath, META);
        expect(a).not.toBe(b);
        expect(store.tasks.get(a)).toMatchObject({ url, quality, outputPath, status: "pending" });
      }),
    );
  });
});
