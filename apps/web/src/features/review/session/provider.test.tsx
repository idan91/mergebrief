// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { briefFixture } from "@web/features/brief/test-utils";
import { buildBriefViewModel } from "@web/features/brief/model";
import {
  emptySessionPayload,
  ReviewSessionProvider,
  useReviewSession,
  useUnplacedDrafts,
  type ReviewSessionPayload,
  type SessionReadSource,
  type SessionWrites,
} from ".";
import { makeSessionReadDriver } from "../utils/session-read-driver";
import { CommentAnchorKinds, DraftCommentStatuses } from "types/comments";
import type { SessionDraftComment } from "./serverState";
import type { SessionWriteResult } from "./writes";

afterEach(cleanup);

const model = buildBriefViewModel(briefFixture);
const OK: SessionWriteResult = { ok: true, value: undefined };

function makeReadSource() {
  const driver = makeSessionReadDriver();
  return {
    ...driver,
    landRead: (payload: ReviewSessionPayload) => {
      act(() => {
        driver.landRead(payload);
      });
    },
  };
}

function makeHeldWrites() {
  const releases: ((result: SessionWriteResult) => void)[] = [];
  const hold = (): Promise<SessionWriteResult> =>
    new Promise((resolve) => {
      releases.push(resolve);
    });
  const writes: SessionWrites = {
    setRead: hold,
    reclassify: hold,
    createDraft: () => Promise.resolve({ ok: true, value: "1" }),
    updateDraft: hold,
    reanchorDraft: hold,
    deleteDraft: hold,
    dismissRisks: hold,
    addressRisks: hold,
    reopenRisks: hold,
    setOutcome: hold,
  };
  return {
    writes,
    releaseWrites: () => {
      for (const release of releases.splice(0)) {
        release(OK);
      }
    },
  };
}

async function waitForPendingWork(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function buildSessionWithReadMarks(
  ...chunkIds: string[]
): ReviewSessionPayload {
  return { ...emptySessionPayload(), readMarks: chunkIds };
}

interface ProviderInputs {
  briefId: string;
  session?: ReviewSessionPayload | undefined;
  reads?: SessionReadSource | undefined;
  writes?: SessionWrites | undefined;
}

function renderSession(initial: ProviderInputs) {
  let inputs = initial;
  function Wrapper({ children }: { children?: ReactNode }) {
    return (
      <ReviewSessionProvider
        briefId={inputs.briefId}
        model={model}
        reads={inputs.reads}
        session={inputs.session}
        writes={inputs.writes}
      >
        {children}
      </ReviewSessionProvider>
    );
  }
  const utils = renderHook(
    () => ({
      reviewedChunks: useReviewSession((state) => state.reviewedChunks),
      actions: useReviewSession((state) => state.actions),
      unplacedDrafts: useUnplacedDrafts(),
    }),
    { wrapper: Wrapper },
  );
  return {
    ...utils,
    switchTo: (next: ProviderInputs) => {
      inputs = next;
      utils.rerender();
    },
  };
}

describe("ReviewSessionProvider reads", () => {
  // React warns once per component pair per module, so this runs first.
  it("never updates a subscriber while rendering", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const read = makeReadSource();
    const { switchTo } = renderSession({ briefId: "b1", reads: read.source });

    switchTo({
      briefId: "b2",
      reads: read.source,
      session: buildSessionWithReadMarks("chunk-a"),
    });
    read.landRead(buildSessionWithReadMarks("chunk-b"));

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("applies a session read that lands through the source", () => {
    const read = makeReadSource();
    const { result } = renderSession({ briefId: "b1", reads: read.source });

    read.startRead();
    read.landRead(buildSessionWithReadMarks("chunk-a"));

    expect(result.current.reviewedChunks.has("chunk-a")).toBe(true);
  });

  it("leaves the store alone when the same payload lands again", () => {
    const read = makeReadSource();
    const session = buildSessionWithReadMarks("chunk-a");
    const { result } = renderSession({
      briefId: "b1",
      reads: read.source,
      session,
    });
    const before = result.current.reviewedChunks;

    read.startRead();
    read.landRead(session);

    expect(result.current.reviewedChunks).toBe(before);
  });

  it("keeps an optimistic write over a read that began before it", async () => {
    const read = makeReadSource();
    const { writes, releaseWrites } = makeHeldWrites();
    const { result } = renderSession({
      briefId: "b1",
      reads: read.source,
      session: emptySessionPayload(),
      writes,
    });

    read.startRead();
    act(() => {
      result.current.actions.reviewChunk("chunk-a");
    });
    expect(read.hasPendingWrite()).toBe(true);
    releaseWrites();
    await waitFor(() => expect(read.hasPendingWrite()).toBe(false));
    read.landRead(emptySessionPayload());

    expect(result.current.reviewedChunks.has("chunk-a")).toBe(true);
  });

  it("applies a read that began after the write settled", async () => {
    const read = makeReadSource();
    const { writes, releaseWrites } = makeHeldWrites();
    const { result } = renderSession({
      briefId: "b1",
      reads: read.source,
      session: emptySessionPayload(),
      writes,
    });

    act(() => {
      result.current.actions.reviewChunk("chunk-a");
    });
    releaseWrites();
    await waitFor(() => expect(read.hasPendingWrite()).toBe(false));
    read.startRead();
    read.landRead(buildSessionWithReadMarks("chunk-a", "chunk-b"));

    expect(result.current.reviewedChunks.has("chunk-b")).toBe(true);
  });

  it("rereads once after the writes a dropped read waited on settle", async () => {
    const read = makeReadSource();
    const { writes, releaseWrites } = makeHeldWrites();
    const { result } = renderSession({
      briefId: "b1",
      reads: read.source,
      session: emptySessionPayload(),
      writes,
    });

    read.startRead();
    act(() => {
      result.current.actions.reviewChunk("chunk-a");
      result.current.actions.reviewChunk("chunk-b");
    });
    read.landRead(buildSessionWithReadMarks("chunk-c"));
    read.landRead(buildSessionWithReadMarks("chunk-d"));
    await waitForPendingWork();
    expect(read.countReadRequests()).toBe(0);

    releaseWrites();
    await waitFor(() => expect(read.countReadRequests()).toBe(1));
    await waitForPendingWork();

    expect(read.countReadRequests()).toBe(1);
  });

  it("rereads at once when the write behind a dropped read has settled", async () => {
    const read = makeReadSource();
    const { writes, releaseWrites } = makeHeldWrites();
    const { result } = renderSession({
      briefId: "b1",
      reads: read.source,
      session: emptySessionPayload(),
      writes,
    });

    read.startRead();
    act(() => {
      result.current.actions.reviewChunk("chunk-a");
    });
    releaseWrites();
    await waitFor(() => expect(read.hasPendingWrite()).toBe(false));
    read.landRead(buildSessionWithReadMarks("chunk-b"));
    await waitForPendingWork();

    expect(read.countReadRequests()).toBe(1);
  });

  it("asks for no reread when a read applies", async () => {
    const read = makeReadSource();
    renderSession({ briefId: "b1", reads: read.source });

    read.startRead();
    read.landRead(buildSessionWithReadMarks("chunk-a"));
    await waitForPendingWork();

    expect(read.countReadRequests()).toBe(0);
  });

  it("cancels a pending reread when the provider switches Brief", async () => {
    const read = makeReadSource();
    const { writes, releaseWrites } = makeHeldWrites();
    const { result, switchTo } = renderSession({
      briefId: "b1",
      reads: read.source,
      session: emptySessionPayload(),
      writes,
    });

    read.startRead();
    act(() => {
      result.current.actions.reviewChunk("chunk-a");
    });
    read.landRead(buildSessionWithReadMarks("chunk-b"));
    switchTo({ briefId: "b2", reads: read.source, writes });
    releaseWrites();
    await waitForPendingWork();

    expect(read.countReadRequests()).toBe(0);
  });

  it("cancels a reread already asked for when the provider unmounts", async () => {
    const read = makeReadSource();
    const { writes, releaseWrites } = makeHeldWrites();
    const { result, unmount } = renderSession({
      briefId: "b1",
      reads: read.source,
      session: emptySessionPayload(),
      writes,
    });

    read.startRead();
    act(() => {
      result.current.actions.reviewChunk("chunk-a");
    });
    releaseWrites();
    await waitFor(() => expect(read.hasPendingWrite()).toBe(false));
    read.landRead(buildSessionWithReadMarks("chunk-b"));
    unmount();
    await waitForPendingWork();

    expect(read.countReadRequests()).toBe(0);
  });

  it("gives a switched Brief a fresh store", () => {
    const { result, switchTo } = renderSession({ briefId: "b1" });
    const firstActions = result.current.actions;

    switchTo({ briefId: "b2" });

    expect(result.current.actions).not.toBe(firstActions);
  });

  it("replaces the unplaced drafts with each landed read", () => {
    const unplaced: SessionDraftComment = {
      id: "4001",
      filePath: "src/elsewhere.ts",
      kind: CommentAnchorKinds.FILE,
      body: "left the brief",
      status: DraftCommentStatuses.DRAFT,
    };
    const read = makeReadSource();
    const { result } = renderSession({
      briefId: "b1",
      reads: read.source,
      session: { ...emptySessionPayload(), draftComments: [unplaced] },
    });
    expect(result.current.unplacedDrafts).toEqual([unplaced]);

    read.startRead();
    read.landRead(emptySessionPayload());

    expect(result.current.unplacedDrafts).toEqual([]);
  });
});
