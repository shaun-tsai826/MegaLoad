import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";

import type { HistoryRecord } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import HistoryPage from "../HistoryPage.vue";
import { useDownloadTaskStore } from "@/stores/downloadTask";

const mockInvoke = vi.mocked(invoke);

function record(id: string, overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id,
    url: "https://e/v",
    title: `title-${id}`,
    thumbnail: "",
    quality: "720p",
    outputPath: "/out",
    filePath: null,
    status: "failed",
    errorMessage: "網路連線中斷：x",
    createdAt: "2026-10-16T00:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

const RECORDS = [
  record("done", { status: "completed", filePath: "/out/a [720p].mp4", errorMessage: null, completedAt: "2026-10-16T01:00:00Z" }),
  record("fail"),
  record("cancel", { status: "cancelled", errorMessage: null }),
];

async function mountPage() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", component: { template: "<div />" } },
      { path: "/history", component: HistoryPage },
    ],
  });
  await router.push("/history");
  const w = mount(HistoryPage, { global: { plugins: [router] } });
  await flushPromises();
  return { w, router };
}

function row(w: ReturnType<typeof mount>, id: string) {
  return w.find(`tr[data-id="${id}"]`);
}

function button(el: { findAll: (s: string) => { text(): string; trigger(e: string): Promise<void> }[] }, text: string) {
  const b = el.findAll("button").find((x) => x.text() === text);
  if (!b) throw new Error(`no button ${text}`);
  return b;
}

beforeEach(() => {
  setActivePinia(createPinia());
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd) => {
    if (cmd === "get_history") return RECORDS.map((r) => ({ ...r }));
    if (cmd === "start_download") return "new-task";
    return undefined;
  });
});

describe("HistoryPage", () => {
  it("lists records with status badges and the right actions", async () => {
    const { w } = await mountPage();
    expect(w.findAll("tbody tr")).toHaveLength(3);
    expect(row(w, "done").text()).toContain("已完成");
    expect(row(w, "done").text()).toContain("開啟位置");
    expect(row(w, "done").text()).not.toContain("重試");
    expect(row(w, "fail").text()).toContain("失敗");
    expect(row(w, "fail").text()).toContain("網路連線中斷");
    expect(row(w, "fail").text()).toContain("重試");
    expect(row(w, "cancel").text()).toContain("已取消");
    expect(row(w, "cancel").text()).toContain("重試");
  });

  it("deletes one record", async () => {
    const { w } = await mountPage();
    await button(row(w, "fail"), "清除").trigger("click");
    await flushPromises();
    expect(mockInvoke).toHaveBeenCalledWith("delete_history_item", { id: "fail" });
    expect(w.findAll("tbody tr")).toHaveLength(2);
  });

  it("asks for confirmation before clearing everything", async () => {
    const { w } = await mountPage();
    await button(w, "清除全部歷史").trigger("click");
    expect(mockInvoke).not.toHaveBeenCalledWith("clear_all_history");
    await button(w, "確定清除").trigger("click");
    await flushPromises();
    expect(mockInvoke).toHaveBeenCalledWith("clear_all_history");
    expect(w.text()).toContain("尚無下載歷史記錄");
  });

  it("retries with the original parameters and goes home", async () => {
    const { w, router } = await mountPage();
    await button(row(w, "cancel"), "重試").trigger("click");
    await flushPromises();
    expect(mockInvoke).toHaveBeenCalledWith("start_download", {
      url: "https://e/v",
      quality: "720p",
      outputPath: "/out",
      title: "title-cancel",
      thumbnail: "",
    });
    expect(useDownloadTaskStore().tasks.has("new-task")).toBe(true);
    expect(router.currentRoute.value.path).toBe("/");
  });

  it("shows errors from the backend", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "get_history") return RECORDS;
      if (cmd === "open_folder") throw { type: "IoError", message: "No such file" };
      return undefined;
    });
    const { w } = await mountPage();
    await button(row(w, "done"), "開啟位置").trigger("click");
    await flushPromises();
    expect(w.find("[role=alert]").text()).toBe("IO 錯誤：No such file");
  });
});
