// Submit mutation behavior (BRIEF-23 PR 3): expected failure statuses map to
// typed result kinds the submit flow renders (fail-closed reload copy, clean
// re-login, upstream rejection); only a malformed 2xx throws.
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../data/apiFetch";

vi.mock("../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from "../../data/apiFetch";
import type { SubmitPayload } from "../review/submit";
import { submitReview } from "./submitReview";

const apiFetchMock = vi.mocked(apiFetch);

const PAYLOAD: SubmitPayload = {
  outcome: "approve",
  commitId: "c".repeat(40),
  body: "Reviewed with Brief — signature",
  comments: [],
};

function run(): ReturnType<typeof submitReview> {
  return submitReview("424242", 7, PAYLOAD);
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
      "/api/repos/424242/pulls/7/review",
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
    await expect(run()).rejects.toMatchObject({ kind: "malformed" });
  });
});
