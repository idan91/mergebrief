// The large run's generating Entry estimate: one call alone, the rest across
// the detail lanes, rounded to five minutes and never under five. The in-place
// edit on an unread head, logged only when it lands, and the newer head's
// sync when a write lands after the head moved.
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

const UNREAD_HEAD = { kind: HeadReadings.UNREAD, error: "timeout" } as const;

/** The pre-write read finds `before`; the next one finds `after`. */
function stubWatchMovingTo(
  after: HeadRead,
  before: HeadRead = { kind: HeadReadings.CURRENT },
): SupersessionWatch {
  const reads: HeadRead[] = [before, after];
  return {
    readHead: async () => reads.shift() ?? after,
    getObserved: () => ({ headSha: NEWER_HEAD }),
    isPinned: () => false,
  } as unknown as SupersessionWatch;
}

async function listSyncedHeads(
  after: HeadRead,
  edit: EntryWrite = EntryWrites.WRITTEN,
  before?: HeadRead,
): Promise<string[]> {
  const synced: string[] = [];
  await postGeneratingEntry(
    {
      entryCommentManager: stubManager(edit),
      headSha: OWN_HEAD,
      log: captureLogger().logger,
      watch: stubWatchMovingTo(after, before),
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
  it("logs this head's Entry edited in place when the edit lands", async () => {
    const lines = await postHeldEditOnUnreadHead(EntryWrites.WRITTEN);

    expect(lines).toContain(
      "generate: head unread, this head's Entry edited in place",
    );
  });

  it.each([EntryWrites.CONFLICTED, EntryWrites.FAILED, EntryWrites.REFUSED])(
    "never logs an in-place edit when the edit is %s",
    async (edit) => {
      const lines = await postHeldEditOnUnreadHead(edit);

      expect(lines).not.toContain(
        "generate: head unread, this head's Entry edited in place",
      );
      expect(lines).toContain(
        "generate: head unread, this head's Entry edit did not land",
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

  it("queues the newer head's sync when a held edit on an unread head lands", async () => {
    const moved = { kind: HeadReadings.MOVED } as const;

    expect(
      await listSyncedHeads(moved, EntryWrites.WRITTEN, UNREAD_HEAD),
    ).toEqual([NEWER_HEAD]);
  });

  it("queues no sync when the head read after the write fails", async () => {
    expect(await listSyncedHeads(UNREAD_HEAD)).toEqual([]);
  });

  it("queues no sync while the head stays current or the write left", async () => {
    const current = { kind: HeadReadings.CURRENT } as const;
    const moved = { kind: HeadReadings.MOVED } as const;

    expect(await listSyncedHeads(current)).toEqual([]);
    expect(await listSyncedHeads(moved, EntryWrites.LEFT)).toEqual([]);
  });
});
