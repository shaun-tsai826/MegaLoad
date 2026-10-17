import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import fc from "fast-check";

import type { DownloadTask, VideoMetadata } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import DownloadList from "../DownloadList.vue";
import DownloadTaskCard from "../DownloadTaskCard.vue";
import UrlInputBar from "../UrlInputBar.vue";
import VideoPreview from "../VideoPreview.vue";
import { useDownloadTaskStore } from "@/stores/downloadTask";
import { useUrlInputStore } from "@/stores/urlInput";
import { validateUrl } from "@/utils/urlValidator";

const mockInvoke = vi.mocked(invoke);
const URL = "https://www.youtube.com/watch?v=c56t7upa8Bk";
const META: VideoMetadata = {
  title: "Hans Zimmer - Time",
  thumbnail: "https://i.ytimg.com/t.jpg",
  duration: 275,
  uploader: "Hans Zimmer",
  availableQualities: ["480p", "1080p", "audio_mp3"],
};

beforeEach(() => {
  setActivePinia(createPinia());
  mockInvoke.mockReset();
});

function task(overrides: Partial<DownloadTask> = {}): DownloadTask {
  return {
    id: "t1",
    url: URL,
    title: "Time",
    thumbnail: "",
    quality: "1080p",
    outputPath: "/Users/me/Downloads",
    status: "downloading",
    percent: 45.3,
    speed: "1.23MiB/s",
    speedBytes: 1.23 * 1024 * 1024,
    etaSeconds: 23,
    segment: 1,
    filePath: null,
    errorMessage: null,
    errorType: null,
    createdAt: "2026-10-16T00:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

describe("UrlInputBar", () => {
  it("shows an error and disables the button for an invalid URL", async () => {
    const w = mount(UrlInputBar);
    await w.find("input").setValue("not a url");
    expect(w.text()).toContain("網址格式不正確");
    expect(w.find("button").attributes("disabled")).toBeDefined();

    await w.find("input").setValue(URL);
    expect(w.text()).not.toContain("網址格式不正確");
    expect(w.find("button").attributes("disabled")).toBeUndefined();
  });

  it("shows a spinner while parsing and the auth message on AuthRequired", async () => {
    let reject!: (e: unknown) => void;
    mockInvoke.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
    const w = mount(UrlInputBar);
    await w.find("input").setValue(URL);
    await w.find("form").trigger("submit");
    expect(w.find("[data-testid=parse-spinner]").exists()).toBe(true);
    expect(w.find("button").attributes("disabled")).toBeDefined();

    reject({ type: "AuthRequired" });
    await flushPromises();
    expect(w.find("[data-testid=parse-spinner]").exists()).toBe(false);
    expect(w.text()).toContain("此影片需要登入帳號方可存取");
    expect(w.find("button").attributes("disabled")).toBeUndefined();
  });

  // Property 1: URL 驗證正確性（Validates: Requirements 1.2, 1.3, 1.4）
  it("Property 1: the button is enabled exactly when validateUrl passes", () => {
    const w = mount(UrlInputBar);
    const store = useUrlInputStore();
    fc.assert(
      fc.property(fc.oneof(fc.webUrl(), fc.string(), fc.constant("ftp://x.com")), (input) => {
        store.setUrl(input);
        const valid = validateUrl(input);
        if (valid) expect(() => new globalThis.URL(input.trim())).not.toThrow();
        expect(store.canParse).toBe(valid);
      }),
    );
    w.unmount();
  });
});

describe("VideoPreview", () => {
  async function mountWithMetadata() {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "get_default_download_dir") return "/Users/me/Downloads";
      if (cmd === "parse_video") return META;
      if (cmd === "start_download") return "new-task";
      if (cmd === "select_folder") return null;
      return undefined;
    });
    const store = useUrlInputStore();
    store.setUrl(URL);
    await store.parseVideo();
    const w = mount(VideoPreview);
    await flushPromises();
    return { w, store };
  }

  it("is hidden without metadata", () => {
    mockInvoke.mockResolvedValue("/d");
    expect(mount(VideoPreview).find("section").exists()).toBe(false);
  });

  it("shows metadata, qualities in priority order and the default path", async () => {
    const { w } = await mountWithMetadata();
    expect(w.text()).toContain("Hans Zimmer - Time");
    expect(w.text()).toContain("4:35");
    const labels = w.findAll("label").map((l) => l.text());
    expect(labels).toEqual(["1080p", "480p", "僅音訊 MP3"]);
    expect((w.find("input[value='1080p']").element as HTMLInputElement).checked).toBe(true);
    expect(w.find("[data-testid=selected-path]").text()).toBe("/Users/me/Downloads");
  });

  it("keeps the path when the folder dialog is cancelled", async () => {
    const { w } = await mountWithMetadata();
    await w.findAll("button").find((b) => b.text() === "變更路徑")!.trigger("click");
    await flushPromises();
    expect(w.find("[data-testid=selected-path]").text()).toBe("/Users/me/Downloads");
  });

  it("starts the download with the chosen options and resets for the next URL", async () => {
    const { w, store } = await mountWithMetadata();
    await w.find("input[value='480p']").setValue(true);
    await w.findAll("button").find((b) => b.text() === "開始下載")!.trigger("click");
    await flushPromises();

    expect(mockInvoke).toHaveBeenCalledWith("start_download", {
      url: URL,
      quality: "480p",
      outputPath: "/Users/me/Downloads",
      title: META.title,
      thumbnail: META.thumbnail,
    });
    expect(useDownloadTaskStore().tasks.has("new-task")).toBe(true);
    expect(store.url).toBe("");
    expect(store.selectedPath).toBe("/Users/me/Downloads");
  });
});

describe("DownloadTaskCard", () => {
  it("shows progress, speed in MB/s, ETA and a cancel button while downloading", () => {
    const w = mount(DownloadTaskCard, { props: { task: task() } });
    const line = w.find("[data-testid=status-line]").text();
    expect(line).toContain("45.3%");
    expect(line).toContain("1.2 MB/s");
    expect(line).toContain("剩餘 0:23");
    expect(w.find("[role=progressbar]").attributes("aria-valuenow")).toBe("45");
    expect(w.findAll("button").map((b) => b.text())).toEqual(["取消"]);
  });

  it("labels the second segment", () => {
    const w = mount(DownloadTaskCard, { props: { task: task({ segment: 2, percent: 10 }) } });
    expect(w.text()).toContain("第 2 段");
  });

  it("cancels through the store", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const w = mount(DownloadTaskCard, { props: { task: task() } });
    await w.find("button").trigger("click");
    expect(mockInvoke).toHaveBeenCalledWith("cancel_download", { taskId: "t1" });
    expect(w.find("button").text()).toBe("取消中…");
  });

  it("offers to reveal a completed file", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const w = mount(DownloadTaskCard, {
      props: { task: task({ status: "completed", percent: 100, filePath: "/d/Time [1080p].mp4" }) },
    });
    expect(w.text()).toContain("已完成");
    await w.findAll("button").find((b) => b.text() === "開啟檔案位置")!.trigger("click");
    expect(mockInvoke).toHaveBeenCalledWith("open_folder", { path: "/d/Time [1080p].mp4" });
  });

  it("shows the error and a retry button on failure", () => {
    const w = mount(DownloadTaskCard, {
      props: { task: task({ status: "failed", errorMessage: "網路連線中斷：x" }) },
    });
    expect(w.text()).toContain("⚠ 網路連線中斷：x");
    expect(w.findAll("button").map((b) => b.text())).toContain("重試");
  });

  it("shows cancelled as cancelled with a retry button", () => {
    const w = mount(DownloadTaskCard, { props: { task: task({ status: "cancelled" }) } });
    expect(w.text()).toContain("已取消");
    expect(w.text()).not.toContain("⚠");
    expect(w.findAll("button").map((b) => b.text())).toContain("重試");
  });
});

describe("DownloadList", () => {
  it("shows an empty state, then one card per task", async () => {
    const w = mount(DownloadList);
    expect(w.text()).toContain("目前沒有下載任務");

    const store = useDownloadTaskStore();
    store.tasks.set("a", task({ id: "a" }));
    store.tasks.set("b", task({ id: "b", status: "completed" }));
    await w.vm.$nextTick();
    expect(w.findAllComponents(DownloadTaskCard)).toHaveLength(2);
    expect(w.text()).toContain("1 個進行中");
  });
});
