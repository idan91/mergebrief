// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  emptySessionPayload,
  type SessionReadSource,
  type SessionWrites,
} from "@web/features/review/session";
import type { SubmitReviewAction } from "@web/features/review/utils";
import { buildPrReview, findMainContent, type PrReviewInput } from "./utils";

const SESSION_REASON = "session unavailable";

function stubReads(): SessionReadSource {
  return { subscribe: () => () => undefined, requestRead: vi.fn() };
}

function makeInput(overrides: Partial<PrReviewInput> = {}): PrReviewInput {
  return {
    submitReview: vi.fn<SubmitReviewAction>(),
    readOnly: undefined,
    postingDisabled: undefined,
    staleHead: false,
    ownDraft: undefined,
    session: emptySessionPayload(),
    sessionReads: stubReads(),
    writes: {} as SessionWrites,
    sessionUnavailableReason: SESSION_REASON,
    meta: { viewerIsAuthor: false },
    ...overrides,
  };
}

describe("buildPrReview", () => {
  it("keeps session writes open while posting is off", () => {
    const postingDisabled = { reason: "demo" };
    const input = makeInput({ postingDisabled });

    const review = buildPrReview(input);

    expect(review.readOnly).toBeUndefined();
    expect(review.postingDisabled).toBe(postingDisabled);
    expect(review.writes).toBe(input.writes);
  });

  it("writes through the session once one is in hand", () => {
    const input = makeInput();

    const review = buildPrReview(input);

    expect(review.readOnly).toBeUndefined();
    expect(review.writes).toBe(input.writes);
    expect(review.session).toBe(input.session);
    expect(review.sessionReads).toBe(input.sessionReads);
    expect(review.submitReview).toBe(input.submitReview);
  });

  it("reads only, with the session reason, while no session is in hand", () => {
    const review = buildPrReview(makeInput({ session: undefined }));

    expect(review.readOnly).toEqual({ reason: SESSION_REASON });
    expect(review.writes).toBeUndefined();
    expect(review.session).toBeUndefined();
  });

  it.each([true, false])(
    "carries the meta's author flag %s to the review",
    (viewerIsAuthor) => {
      const review = buildPrReview(makeInput({ meta: { viewerIsAuthor } }));

      expect(review.viewerIsAuthor).toBe(viewerIsAuthor);
    },
  );

  it("keeps the base-drift reason over the session's", () => {
    const readOnly = { reason: "base drift" };

    const review = buildPrReview(makeInput({ readOnly, session: undefined }));

    expect(review.readOnly).toBe(readOnly);
  });
});

describe("findMainContent", () => {
  it("finds the reading region by its skip-link id", () => {
    const main = document.createElement("main");
    main.id = "main-content";
    document.body.append(main);

    expect(findMainContent()).toBe(main);

    main.remove();
  });
});
