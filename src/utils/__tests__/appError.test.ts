import { describe, expect, it } from "vitest";

import { describeError, toAppError } from "../appError";

describe("toAppError", () => {
  it("keeps errors serialized by Rust", () => {
    expect(toAppError({ type: "NetworkError", message: "timed out" })).toEqual({
      type: "NetworkError",
      message: "timed out",
    });
    expect(toAppError({ type: "AuthRequired" })).toEqual({ type: "AuthRequired" });
  });

  it("wraps anything else as Unknown", () => {
    expect(toAppError("command not found")).toEqual({ type: "Unknown", message: "command not found" });
    expect(toAppError(new Error("boom"))).toEqual({ type: "Unknown", message: "boom" });
    expect(toAppError({ type: "Weird" })).toEqual({ type: "Unknown", message: "[object Object]" });
  });
});

describe("describeError", () => {
  it("matches the Rust Display strings", () => {
    expect(describeError({ type: "AuthRequired" })).toBe("認證失敗：此影片需要登入帳號方可存取");
    expect(describeError({ type: "YtDlpError", message: "Unsupported URL" })).toBe("yt-dlp 錯誤：Unsupported URL");
    expect(describeError({ type: "IoError", message: "x" })).toBe("IO 錯誤：x");
  });
});
