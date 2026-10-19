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
  localStorage.clear();
  setActivePinia(createPinia());
  mockInvoke.mockReset();
  mockInvoke.mockImplementation(async (cmd) => {
    if (cmd === "get_history") return RECORDS.map((r) => ({ ...r }));
    if (cmd === "start_download") return "new-task";
    if (cmd === "file_exists") return false;
    return undefined;
  });
});

/** Makes get_history return `records` and file_exists return `exists`. */
function backend(records: HistoryRecord[], exists = false) {
  mockInvoke.mockImplementation(async (cmd) => {
    if (cmd === "get_history") return records.map((r) => ({ ...r }));
    if (cmd === "start_download") return "new-task";
    if (cmd === "file_exists") return exists;
    return undefined;
  });
}

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

describe("HistoryPage re-download", () => {
  it("offers re-download on completed records only", async () => {
    const { w } = await mountPage();
    expect(row(w, "done").text()).toContain("重新下載");
    expect(row(w, "fail").text()).not.toContain("重新下載");
    expect(row(w, "cancel").text()).not.toContain("重新下載");
  });

  it("downloads right away when the file is gone", async () => {
    backend(RECORDS, false);
    const { w, router } = await mountPage();
    await button(row(w, "done"), "重新下載").trigger("click");
    await flushPromises();
    expect(mockInvoke).toHaveBeenCalledWith("file_exists", { path: "/out/a [720p].mp4" });
    expect(mockInvoke).toHaveBeenCalledWith("start_download", {
      url: "https://e/v",
      quality: "720p",
      outputPath: "/out",
      title: "title-done",
      thumbnail: "",
    });
    expect(router.currentRoute.value.path).toBe("/");
  });

  it("asks before overwriting an existing file", async () => {
    backend(RECORDS, true);
    const { w, router } = await mountPage();
    await button(row(w, "done"), "重新下載").trigger("click");
    await flushPromises();
    expect(row(w, "done").text()).toContain("檔案已存在，要覆蓋嗎？");
    expect(mockInvoke).not.toHaveBeenCalledWith("start_download", expect.anything());

    await button(row(w, "done"), "覆蓋下載").trigger("click");
    await flushPromises();
    expect(mockInvoke).toHaveBeenCalledWith("start_download", expect.objectContaining({ overwrite: true }));
    expect(router.currentRoute.value.path).toBe("/");
  });

  it("cancelling the overwrite keeps the file and starts nothing", async () => {
    backend(RECORDS, true);
    const { w, router } = await mountPage();
    await button(row(w, "done"), "重新下載").trigger("click");
    await flushPromises();
    await button(row(w, "done"), "取消").trigger("click");
    await flushPromises();
    expect(row(w, "done").text()).toContain("重新下載");
    expect(mockInvoke).not.toHaveBeenCalledWith("start_download", expect.anything());
    expect(router.currentRoute.value.path).toBe("/history");
  });
});

describe("HistoryPage pagination", () => {
  const MANY = Array.from({ length: 23 }, (_, i) => record(`r${i}`));

  it("has no pager for 5 records or fewer", async () => {
    backend(MANY.slice(0, 5));
    const { w } = await mountPage();
    expect(w.find("nav[aria-label='分頁']").exists()).toBe(false);
  });

  it("shows 10 per page and switches pages", async () => {
    backend(MANY);
    const { w } = await mountPage();
    expect(w.findAll("tbody tr")).toHaveLength(10);
    expect(w.find("[data-testid=page-range]").text()).toBe("第 1–10 筆，共 23 筆");

    await button(w, "3").trigger("click");
    expect(w.findAll("tbody tr")).toHaveLength(3);
    expect(row(w, "r20").exists()).toBe(true);
    expect(w.find("[aria-current=page]").text()).toBe("3");

    await w.find("button[aria-label='上一頁']").trigger("click");
    expect(w.find("[data-testid=page-range]").text()).toBe("第 11–20 筆，共 23 筆");
  });

  it("disables the arrows at either end", async () => {
    backend(MANY);
    const { w } = await mountPage();
    expect(w.find("button[aria-label='上一頁']").attributes("disabled")).toBeDefined();
    expect(w.find("button[aria-label='下一頁']").attributes("disabled")).toBeUndefined();
  });

  it("changes the page size", async () => {
    backend(MANY);
    const { w } = await mountPage();
    const options = w.findAll("select option").map((o) => o.text());
    expect(options).toEqual(["5", "10", "20"]);

    await w.find("select").setValue("20");
    expect(w.findAll("tbody tr")).toHaveLength(20);
    await w.find("select").setValue("5");
    expect(w.findAll("tbody tr")).toHaveLength(5);
    expect(w.find("[data-testid=page-range]").text()).toBe("第 1–5 筆，共 23 筆");
  });
});
