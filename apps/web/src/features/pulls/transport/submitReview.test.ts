// Submit mutation behavior: expected failure statuses map to typed result kinds
// the submit flow renders (fail-closed reload copy, clean re-login, upstream
// rejection); only a malformed 2xx throws.
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../../data/apiFetch";

vi.mock("../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from "../../../data/apiFetch";
import type { SubmitPayload } from "../../review/utils/submit";
import { submitReview } from "./submitReview";

const apiFetchMock = vi.mocked(apiFetch);

const SPAN = { base: "b".repeat(40), head: "c".repeat(40) };
const PAYLOAD: SubmitPayload = {
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
        JSON.stringify({ reviewId: 987001, commentsDegraded: false }),
        {
          status: 201,
        },
      ),
    );
    await expect(run()).resolves.toEqual({
      kind: "submitted",
      reviewId: 987001,
      commentsDegraded: false,
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

  it("surfaces commentsDegraded for the receipt note", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ reviewId: 5, commentsDegraded: true }), {
        status: 201,
      }),
    );
    await expect(run()).resolves.toMatchObject({ commentsDegraded: true });
  });

  it("maps the fail-closed 409 to the rewritten state", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 409 }));
    await expect(run()).resolves.toEqual({ kind: "rewritten" });
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

  it("maps 401 to unauthorized (clean re-login)", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(run()).resolves.toEqual({ kind: "unauthorized" });
  });

  it("maps 404 to not-found", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 404 }));
    await expect(run()).resolves.toEqual({ kind: "not-found" });
  });

  it("maps 502 (and other upstream failures) to upstream", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 502 }));
    await expect(run()).resolves.toEqual({ kind: "upstream" });
  });

  it("throws a typed malformed error on a 201 with a bad shape", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), { status: 201 }),
    );
    await expect(run()).rejects.toBeInstanceOf(ApiError);
    await expect(run()).rejects.toMatchObject({ code: "malformed" });
  });
});
