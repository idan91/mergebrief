// The supersession watch at its seam: a moved head aborts the run until the
// watch is pinned; pinned, it records the head, keeps renewing the claim and
// lets the Entry posts stand down instead of ending the run.
import { describe, expect, it, vi } from "vitest";
import type { PullRequestSource } from "../../src/task/github-port";
import { SupersededSignal } from "../../src/task/generate/logic/run-signals";
import {
  createSupersessionWatch,
  readEntryPostHead,
} from "../../src/task/generate/logic/supersession-watch";
import { HeadReadings } from "../../src/task/generate/types";
import { HEAD_1, HEAD_2, makePullRequestInfo } from "./helpers";

const POLL_MS = 5;

interface WatchedSource {
  readonly source: PullRequestSource;
  /** Every head read from here on sees `headSha`. */
  readonly moveHead: (headSha: string) => void;
  /** How many times the watch read the head from GitHub. */
  readonly countHeadReads: () => number;
}

function stubHeadSource(): WatchedSource {
  let head = HEAD_1;
  let reads = 0;
  const source = {
    fetchPullRequest: () => {
      reads += 1;
      return Promise.resolve({ ok: true, value: makePullRequestInfo(head) });
    },
  } as unknown as PullRequestSource;
  return {
    source,
    moveHead: (headSha) => {
      head = headSha;
    },
    countHeadReads: () => reads,
  };
}

describe("createSupersessionWatch", () => {
  it("aborts on a moved head and throws from the pre-call check unpinned", async () => {
    const { source, moveHead } = stubHeadSource();
    const watch = createSupersessionWatch(
      source,
      HEAD_1,
      POLL_MS,
      async () => true,
    );
    moveHead(HEAD_2);

    await expect(watch.assertCurrent()).rejects.toBeInstanceOf(
      SupersededSignal,
    );

    expect(watch.signal.aborted).toBe(true);
    expect(watch.getObserved()?.headSha).toBe(HEAD_2);
    await expect(readEntryPostHead(watch)).rejects.toBeInstanceOf(
      SupersededSignal,
    );
  });

  it("records a moved head without aborting once pinned", async () => {
    const { source, moveHead } = stubHeadSource();
    const watch = createSupersessionWatch(
      source,
      HEAD_1,
      POLL_MS,
      async () => true,
    );
    watch.pin();
    moveHead(HEAD_2);

    await expect(watch.assertCurrent()).resolves.toBeUndefined();

    expect(watch.signal.aborted).toBe(false);
    expect(watch.getObserved()?.headSha).toBe(HEAD_2);
    expect(await watch.readHead()).toEqual({ kind: HeadReadings.MOVED });
    expect(await readEntryPostHead(watch)).toEqual({
      kind: HeadReadings.MOVED,
    });
  });

  it("keeps renewing the claim after the head moved under a pinned run", async () => {
    const { source, moveHead } = stubHeadSource();
    let renewals = 0;
    const watch = createSupersessionWatch(source, HEAD_1, POLL_MS, async () => {
      renewals += 1;
      return true;
    });
    watch.pin();
    watch.startPolling();
    try {
      moveHead(HEAD_2);
      await vi.waitFor(() => expect(watch.getObserved()).toBeDefined());
      const seenAt = renewals;

      await vi.waitFor(() => expect(renewals).toBeGreaterThan(seenAt + 1));

      expect(watch.signal.aborted).toBe(false);
    } finally {
      watch.stop();
    }
  });

  it("stops reading the head once a pinned run saw it move", async () => {
    const { source, moveHead, countHeadReads } = stubHeadSource();
    let renewals = 0;
    const watch = createSupersessionWatch(source, HEAD_1, POLL_MS, async () => {
      renewals += 1;
      return true;
    });
    watch.pin();
    watch.startPolling();
    try {
      moveHead(HEAD_2);
      await vi.waitFor(() => expect(watch.getObserved()).toBeDefined());
      const readsAtMove = countHeadReads();
      const renewalsAtMove = renewals;

      await vi.waitFor(() =>
        expect(renewals).toBeGreaterThan(renewalsAtMove + 2),
      );

      expect(countHeadReads()).toBe(readsAtMove);
      await watch.assertCurrent();
      expect(countHeadReads()).toBe(readsAtMove);
    } finally {
      watch.stop();
    }
  });

  it("reads the head fresh for a post and resumes once it moved back", async () => {
    const { source, moveHead, countHeadReads } = stubHeadSource();
    const watch = createSupersessionWatch(source, HEAD_1, POLL_MS, async () => {
      return true;
    });
    watch.pin();
    watch.startPolling();
    try {
      moveHead(HEAD_2);
      await vi.waitFor(() => expect(watch.getObserved()).toBeDefined());
      moveHead(HEAD_1);

      expect(await watch.readHead()).toEqual({ kind: HeadReadings.CURRENT });
      expect(watch.getObserved()).toBeUndefined();
      const readsAfterPost = countHeadReads();
      await vi.waitFor(() =>
        expect(countHeadReads()).toBeGreaterThan(readsAfterPost),
      );
      expect(watch.signal.aborted).toBe(false);
    } finally {
      watch.stop();
    }
  });

  it("still ends a pinned run on a lost claim", async () => {
    const { source } = stubHeadSource();
    const watch = createSupersessionWatch(
      source,
      HEAD_1,
      POLL_MS,
      async () => false,
    );
    watch.pin();
    watch.startPolling();
    try {
      await vi.waitFor(() => expect(watch.signal.aborted).toBe(true));
    } finally {
      watch.stop();
    }
  });
});
