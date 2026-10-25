import { describe, expect, it, vi } from "vitest";

import {
  emptySessionPayload,
  type SessionReadSource,
  type SessionWrites,
} from "@web/features/review/session";
import type { SubmitReviewAction } from "@web/features/review/utils";
import { buildPrReview, type PrReviewInput } from "./utils";

const SESSION_REASON = "session unavailable";

function stubReads(): SessionReadSource {
  return { subscribe: () => () => undefined, requestRead: vi.fn() };
}

function makeInput(overrides: Partial<PrReviewInput> = {}): PrReviewInput {
  return {
    submitReview: vi.fn<SubmitReviewAction>(),
    readOnly: undefined,
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
