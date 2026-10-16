import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import fc from "fast-check";

import type { QualityOption, VideoMetadata } from "@/types";
import { QUALITY_PRIORITY, pickDefaultQuality } from "@/utils/quality";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { useUrlInputStore } from "../urlInput";

const mockInvoke = vi.mocked(invoke);
const URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

function metadata(availableQualities: QualityOption[]): VideoMetadata {
  return { title: "t", thumbnail: "https://i/t.jpg", duration: 1, uploader: "u", availableQualities };
}

beforeEach(() => {
  setActivePinia(createPinia());
  mockInvoke.mockReset();
});

describe("setUrl", () => {
  it("sets validation state", () => {
    const store = useUrlInputStore();
    store.setUrl("");
    expect(store.validationState).toBe("idle");
    store.setUrl("not a url");
    expect(store.validationState).toBe("invalid");
    expect(store.canParse).toBe(false);
    store.setUrl(URL);
    expect(store.validationState).toBe("valid");
    expect(store.canParse).toBe(true);
  });

  it("clears metadata when the URL changes", async () => {
    const store = useUrlInputStore();
    mockInvoke.mockResolvedValueOnce(metadata(["720p", "audio_mp3"]));
    store.setUrl(URL);
    await store.parseVideo();
    expect(store.hasMetadata).toBe(true);

    store.setUrl(URL); // unchanged: keep
    expect(store.hasMetadata).toBe(true);
    store.setUrl(URL + "x");
    expect(store.hasMetadata).toBe(false);
    expect(store.selectedQuality).toBeNull();
  });
});

describe("parseVideo", () => {
  it("stores metadata and preselects the highest quality", async () => {
    const store = useUrlInputStore();
    mockInvoke.mockResolvedValueOnce(metadata(["audio_mp3", "480p", "720p"]));
    store.setUrl(URL);
    await store.parseVideo();
    expect(mockInvoke).toHaveBeenCalledWith("parse_video", { url: URL });
    expect(store.metadata?.title).toBe("t");
    expect(store.selectedQuality).toBe("720p");
    expect(store.isParsing).toBe(false);
  });

  it("stores a normalized error and re-enables parsing", async () => {
    const store = useUrlInputStore();
    mockInvoke.mockRejectedValueOnce({ type: "AuthRequired" });
    store.setUrl(URL);
    await store.parseVideo();
    expect(store.parseError).toEqual({ type: "AuthRequired" });
    expect(store.metadata).toBeNull();
    expect(store.canParse).toBe(true);
  });

  it("ignores a response for a URL that has since changed", async () => {
    const store = useUrlInputStore();
    let resolve!: (m: VideoMetadata) => void;
    mockInvoke.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    store.setUrl(URL);
    const pending = store.parseVideo();
    store.reset();
    resolve(metadata(["1080p"]));
    await pending;
    expect(store.metadata).toBeNull();
    expect(store.isParsing).toBe(false);
  });

  it("does nothing when the URL is invalid", async () => {
    const store = useUrlInputStore();
    store.setUrl("nope");
    await store.parseVideo();
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});

describe("folders", () => {
  it("keeps the current path when the dialog is cancelled", async () => {
    const store = useUrlInputStore();
    mockInvoke.mockResolvedValueOnce("/Users/me/Downloads");
    await store.loadDefaultPath();
    expect(store.selectedPath).toBe("/Users/me/Downloads");

    mockInvoke.mockResolvedValueOnce(null);
    await store.selectFolder();
    expect(store.selectedPath).toBe("/Users/me/Downloads");

    mockInvoke.mockResolvedValueOnce("/Volumes/Media");
    await store.selectFolder();
    expect(store.selectedPath).toBe("/Volumes/Media");
  });

  it("does not overwrite a chosen path with the default", async () => {
    const store = useUrlInputStore();
    store.selectedPath = "/chosen";
    await store.loadDefaultPath();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("reset keeps the selected path", () => {
    const store = useUrlInputStore();
    store.selectedPath = "/chosen";
    store.setUrl(URL);
    store.reset();
    expect(store.url).toBe("");
    expect(store.validationState).toBe("idle");
    expect(store.selectedPath).toBe("/chosen");
  });
});

// Property 5: 預設選取最高畫質（Validates: Requirements 3.1）
describe("Property 5: default quality is the highest available", () => {
  it("holds for any non-empty option list", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.constantFrom(...QUALITY_PRIORITY), { minLength: 1 }),
        async (options) => {
          setActivePinia(createPinia());
          mockInvoke.mockResolvedValueOnce(metadata(options));
          const store = useUrlInputStore();
          store.setUrl(URL);
          await store.parseVideo();
          const best = QUALITY_PRIORITY.find((q) => options.includes(q));
          expect(store.selectedQuality).toBe(best);
          expect(pickDefaultQuality(options)).toBe(best);
        },
      ),
    );
  });
});
