import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

type Handler = (e: { payload: unknown }) => void;
const handlers = new Map<string, Handler>();
const unlisten = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => "task-1") }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, handler: Handler) => {
    handlers.set(event, handler);
    return unlisten;
  }),
}));
vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));

import { sendNotification } from "@tauri-apps/plugin-notification";
import { useDownloadTaskStore } from "@/stores/downloadTask";
import { useHistoryStore } from "@/stores/history";
import { registerDownloadEvents } from "../useTauriEvents";

function emit(event: string, payload: unknown) {
  const handler = handlers.get(event);
  if (!handler) throw new Error(`no listener for ${event}`);
  handler({ payload });
}

async function setup() {
  const stop = await registerDownloadEvents();
  const tasks = useDownloadTaskStore();
  const history = useHistoryStore();
  const id = await tasks.startDownload("https://e/v", "480p", "/out", { title: "Zoo", thumbnail: "" });
  return { stop, tasks, history, id };
}

beforeEach(() => {
  setActivePinia(createPinia());
  handlers.clear();
  unlisten.mockClear();
  vi.mocked(sendNotification).mockClear();
});

describe("registerDownloadEvents", () => {
  it("listens to all four download events", async () => {
    await setup();
    expect([...handlers.keys()].sort()).toEqual([
      "download://cancelled",
      "download://completed",
      "download://failed",
      "download://progress",
    ]);
  });

  it("routes progress to the task store", async () => {
    const { tasks, id } = await setup();
    emit("download://progress", { taskId: id, percent: 42, speed: "1MiB/s", speedBytes: 1, eta: "00:01", etaSeconds: 1 });
    expect(tasks.tasks.get(id)).toMatchObject({ status: "downloading", percent: 42 });
  });

  it("completes the task, adds history and notifies", async () => {
    const { tasks, history, id } = await setup();
    emit("download://completed", { taskId: id, filePath: "/out/Zoo.mp4", title: "Me at the zoo", completedAt: "T" });
    expect(tasks.tasks.get(id)?.status).toBe("completed");
    expect(history.records[0]).toMatchObject({ id, status: "completed", filePath: "/out/Zoo.mp4", completedAt: "T" });
    await vi.waitFor(() =>
      expect(sendNotification).toHaveBeenCalledWith({ title: "下載完成", body: "Zoo" }),
    );
  });

  it("records failures with the error message", async () => {
    const { history, id } = await setup();
    emit("download://failed", { taskId: id, errorType: "NetworkError", message: "網路連線中斷：x" });
    expect(history.records[0]).toMatchObject({ id, status: "failed", errorMessage: "網路連線中斷：x" });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("records cancellation as cancelled", async () => {
    const { tasks, history, id } = await setup();
    emit("download://cancelled", { taskId: id });
    expect(tasks.tasks.get(id)?.status).toBe("cancelled");
    expect(history.records[0]).toMatchObject({ id, status: "cancelled", errorMessage: null });
  });

  it("ignores events for tasks this window did not start", async () => {
    const { history } = await setup();
    emit("download://failed", { taskId: "other", errorType: "Unknown", message: "x" });
    expect(history.records).toEqual([]);
  });

  it("the returned function removes every listener", async () => {
    const { stop } = await setup();
    stop();
    expect(unlisten).toHaveBeenCalledTimes(4);
  });
});
