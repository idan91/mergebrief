import { existsSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readReplyIds, recordReply } from "../src/logic/replies";

function makeStorePath(): string {
  return join(
    mkdtempSync(join(tmpdir(), "pr-replies-")),
    "pr-tool",
    "replies.json",
  );
}

describe("reply store", () => {
  it("reads a missing store as no replies", () => {
    expect(readReplyIds(makeStorePath())).toEqual({
      ok: true,
      value: new Set(),
    });
  });

  it("remembers every recorded reply", () => {
    const store = makeStorePath();

    recordReply(store, 12);
    recordReply(store, 13);

    expect(readReplyIds(store)).toEqual({ ok: true, value: new Set([12, 13]) });
  });

  it("takes over a lock a crashed writer left behind", () => {
    const store = makeStorePath();
    recordReply(store, 1);
    const lock = `${store}.lock`;
    writeFileSync(lock, "");
    const longAgo = new Date(Date.now() - 60_000);
    utimesSync(lock, longAgo, longAgo);

    expect(recordReply(store, 2)).toEqual({ ok: true, value: undefined });
    expect(readReplyIds(store)).toEqual({ ok: true, value: new Set([1, 2]) });
    expect(existsSync(lock)).toBe(false);
  });

  it("refuses a corrupted store instead of reading it as empty", () => {
    const store = join(
      mkdtempSync(join(tmpdir(), "pr-replies-")),
      "replies.json",
    );
    writeFileSync(store, "{not json");

    expect(readReplyIds(store).ok).toBe(false);
  });
});
