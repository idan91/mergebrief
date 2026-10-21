// Submit mutation behavior: expected failure statuses map to typed result kinds
// the submit flow renders (fail-closed reload copy, clean re-login, upstream
// rejection); a malformed 2xx or a network throw reads as indeterminate.
import type { SubmitReviewBody, SubmitReviewResponse } from "contract";
import type { Equals } from "types/utils";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod/v4";

import type * as ApiFetchModule from "../../../data/apiFetch";

vi.mock("../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../../data/apiFetch";
import type { SubmitReviewResult } from "@web/features/review/utils";
import { submitReview, type submittedReviewSchema } from "./submitReview";

const apiFetchMock = vi.mocked(apiFetch);

const SPAN = { base: "b".repeat(40), head: "c".repeat(40) };
true satisfies Equals<
  z.output<typeof submittedReviewSchema>,
  Extract<SubmitReviewResult, { kind: "submitted" }>
>;

/** Every field the parser reads is one the contract sends. */
true satisfies Equals<
  Exclude<
    keyof z.input<typeof submittedReviewSchema>,
    keyof SubmitReviewResponse
  >,
  never
>;

const PAYLOAD: SubmitReviewBody = {
  outcome: "approve",
  body: "Reviewed with MergeBrief — signature",
};

function run(): ReturnType<typeof submitReview> {
  return submitReview("424242", 7, SPAN, PAYLOAD);
}

describe("submitReview", () => {
  it("POSTs the payload to the submit route and parses the 201", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          reviewId: 987001,
          commentsDegraded: false,
          commentsFolded: 0,
          commentsTotal: 2,
        }),
        {
          status: 201,
        },
      ),
    );
    await expect(run()).resolves.toEqual({
      kind: "submitted",
      reviewId: 987001,
      commentsFolded: 0,
      commentsTotal: 2,
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/repos/424242/pulls/7/review?base=${SPAN.base}&head=${SPAN.head}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(PAYLOAD),
      },
    );
  });

  it("surfaces the folded and total counts for the receipt note", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          reviewId: 5,
          commentsDegraded: true,
          commentsFolded: 1,
          commentsTotal: 3,
        }),
        { status: 201 },
      ),
    );
    await expect(run()).resolves.toMatchObject({
      commentsFolded: 1,
      commentsTotal: 3,
    });
  });

  it("reads a 201 that carries no counts as indeterminate", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ reviewId: 5, commentsDegraded: false }), {
        status: 201,
      }),
    );
    await expect(run()).resolves.toEqual({ kind: "indeterminate" });
  });

  it("maps the wire pr-rewritten-since-read code to rewritten", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "pull request was rewritten since it was read",
          code: "pr-rewritten-since-read",
        }),
        { status: 409 },
      ),
    );
    await expect(run()).resolves.toEqual({ kind: "rewritten" });
  });

  it("maps pending-review-held to its own state, never upstream", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "an unsubmitted review of yours is open on GitHub",
          code: "pending-review-held",
        }),
        { status: 409 },
      ),
    );
    await expect(run()).resolves.toEqual({ kind: "pending-review-held" });
  });

  it("maps draft-anchor-orphaned to its own state, never upstream", async () => {
    // "upstream" copy would tell the reviewer GitHub rejected the review and
    // to retry shortly; GitHub was never called and a retry cannot succeed.
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error:
            "this review holds a comment whose anchor no longer points at any code",
          code: "draft-anchor-orphaned",
        }),
        { status: 409 },
      ),
    );
    await expect(run()).resolves.toEqual({ kind: "orphaned-draft" });
  });

  it("maps the claim refusals to their own kinds, never upstream", async () => {
    for (const [code, kind] of [
      ["draft-publish-pending", "publish-pending"],
      ["draft-publish-in-doubt", "publish-in-doubt"],
    ] as const) {
      apiFetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: "conflict", code }), {
          status: 409,
        }),
      );
      await expect(run()).resolves.toEqual({ kind });
    }
  });

  it("maps 404 to not-found", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    await expect(run()).resolves.toEqual({ kind: "not-found" });
  });

  it("maps 502 and other upstream failures to upstream", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 502 }));
    await expect(run()).resolves.toEqual({ kind: "upstream" });
  });

  it("maps every previously-swallowed coded failure deliberately", async () => {
    for (const [code, kind] of [
      // Deterministic 413: an over-long review body; retry-as-is never clears.
      ["request-too-large", "invalid"],
      ["invalid-request", "invalid"],
      ["attachment-unsupported-type", "invalid"],
      ["no-repo-write-access", "no-write-access"],
      ["pr-changed-since-read", "rewritten"],
      ["forbidden", "upstream"],
      ["github-permission", "github-permission"],
      ["scope-exceeded", "upstream"],
      ["human-only", "upstream"],
      ["draft-already-published", "upstream"],
      ["github-unavailable", "upstream"],
      ["internal-error", "upstream"],
    ] as const) {
      apiFetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: "refused", code }), {
          status: 502,
        }),
      );
      await expect(run()).resolves.toEqual({ kind });
    }
  });
});
