// The large run's generating Entry estimate: one call alone, the rest across
// the detail lanes, rounded to five minutes and never under five. And the
// held edit on an unread head, logged only when it lands.
import { describe, expect, it } from "vitest";
import {
  estimateMultiCallMinutes,
  postGeneratingEntry,
} from "../../src/task/generate/logic/generating-entry";
import {
  EntryWrites,
  HeadReadings,
  type EntryCommentManager,
  type EntryWrite,
  type SupersessionWatch,
} from "../../src/task/generate/types";
import { captureLogger } from "./helpers";

function stubUnreadWatch(): SupersessionWatch {
  return {
    readHead: async () => ({ kind: HeadReadings.UNREAD, error: "timeout" }),
    isPinned: () => false,
  } as unknown as SupersessionWatch;
}

function stubManager(edit: EntryWrite): EntryCommentManager {
  return {
    editMatching: async () => edit,
    replace: async () => EntryWrites.LEFT,
  } as unknown as EntryCommentManager;
}

async function postHeldEditOnUnreadHead(edit: EntryWrite): Promise<string[]> {
  const { logger, readLines } = captureLogger();
  await postGeneratingEntry(
    {
      entryCommentManager: stubManager(edit),
      headSha: "a".repeat(40),
      log: logger,
      watch: stubUnreadWatch(),
    },
    "generating",
  );
  return readLines().map((line) => String(line["msg"]));
}

describe("estimateMultiCallMinutes", () => {
  it.each([
    [57, 8, 30],
    [2, 8, 10],
    [9, 8, 10],
    [20, 8, 15],
    [100, 1, 305],
  ])(
    "estimates %i calls over %i lanes as %i minutes",
    (calls, lanes, minutes) => {
      expect(estimateMultiCallMinutes(calls, lanes)).toBe(minutes);
    },
  );
});

describe("postGeneratingEntry on an unread head", () => {
  it("logs the held Entry edited in place when the edit lands", async () => {
    const lines = await postHeldEditOnUnreadHead(EntryWrites.WRITTEN);

    expect(lines).toContain(
      "generate: head unread, the held Entry edited in place",
    );
  });

  it.each([EntryWrites.CONFLICTED, EntryWrites.FAILED, EntryWrites.REFUSED])(
    "never logs an in-place edit when the edit is %s",
    async (edit) => {
      const lines = await postHeldEditOnUnreadHead(edit);

      expect(lines).not.toContain(
        "generate: head unread, the held Entry edited in place",
      );
      expect(lines).toContain(
        "generate: head unread, the held Entry edit did not land",
      );
    },
  );
});
