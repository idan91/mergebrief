// The large run's generating Entry estimate: one call alone, the rest across
// the detail lanes, rounded to five minutes and never under five. The held
// edit on an unread head, logged only when it lands, and the newer head's
// sync when the edit lands after the head moved.
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
  type HeadRead,
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
    editOrRefresh: async () => edit,
    replace: async () => EntryWrites.LEFT,
  } as unknown as EntryCommentManager;
}

const OWN_HEAD = "a".repeat(40);
const NEWER_HEAD = "b".repeat(40);

/** The pre-write read finds the run's head; the next one finds `after`. */
function stubWatchMovingTo(after: HeadRead): SupersessionWatch {
  const reads: HeadRead[] = [{ kind: HeadReadings.CURRENT }, after];
  return {
    readHead: async () => reads.shift() ?? after,
    getObserved: () => ({ headSha: NEWER_HEAD }),
    isPinned: () => false,
  } as unknown as SupersessionWatch;
}

async function listSyncedHeads(
  after: HeadRead,
  edit: EntryWrite = EntryWrites.WRITTEN,
): Promise<string[]> {
  const synced: string[] = [];
  await postGeneratingEntry(
    {
      entryCommentManager: stubManager(edit),
      headSha: OWN_HEAD,
      log: captureLogger().logger,
      watch: stubWatchMovingTo(after),
      queueEntrySync: async (headSha) => {
        synced.push(headSha);
      },
    },
    "generating",
  );
  return synced;
}

async function postHeldEditOnUnreadHead(edit: EntryWrite): Promise<string[]> {
  const { logger, readLines } = captureLogger();
  await postGeneratingEntry(
    {
      entryCommentManager: stubManager(edit),
      headSha: OWN_HEAD,
      log: logger,
      watch: stubUnreadWatch(),
      queueEntrySync: async () => {},
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

describe("postGeneratingEntry after its write lands", () => {
  it("queues the newer head's sync when the head moved meanwhile", async () => {
    expect(await listSyncedHeads({ kind: HeadReadings.MOVED })).toEqual([
      NEWER_HEAD,
    ]);
  });

  it("queues its own head's sync when the head read fails", async () => {
    const unread = { kind: HeadReadings.UNREAD, error: "timeout" } as const;

    expect(await listSyncedHeads(unread)).toEqual([OWN_HEAD]);
  });

  it("queues no sync while the head stays current or the write left", async () => {
    const current = { kind: HeadReadings.CURRENT } as const;
    const moved = { kind: HeadReadings.MOVED } as const;

    expect(await listSyncedHeads(current)).toEqual([]);
    expect(await listSyncedHeads(moved, EntryWrites.LEFT)).toEqual([]);
  });
});
