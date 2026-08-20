// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { readReplyDraft, writeReplyDraft } from "./utils";

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("the composer's durable draft", () => {
  it("round-trips per thread, and an empty body drops the key", () => {
    writeReplyDraft(9001, "half a thought");
    expect(readReplyDraft(9001)).toBe("half a thought");
    expect(readReplyDraft(9002)).toBe("");

    writeReplyDraft(9001, "");
    expect(sessionStorage.getItem("mergebrief.replyDraft.9001")).toBeNull();
  });

  it("survives storage being denied — the composer still renders", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(readReplyDraft(9001)).toBe("");
    expect(() => {
      writeReplyDraft(9001, "typed anyway");
    }).not.toThrow();
  });
});
