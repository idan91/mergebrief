// Reply transport: expected failure statuses are result kinds the composer
// renders, never throws for those; a malformed 2xx throws typed.
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../data/apiFetch";

vi.mock("../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from "../../data/apiFetch";
import { postConversationReply } from "./reply";

const apiFetchMock = vi.mocked(apiFetch);
const SPAN = { base: "b".repeat(40), head: "a".repeat(40) };
const SPAN_QUERY = `base=${SPAN.base}&head=${SPAN.head}`;

describe("postConversationReply", () => {
  it("posts the body to the thread's root comment and returns the created id", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ commentId: 3_600_000_001 }), {
        status: 201,
      }),
    );
    await expect(
      postConversationReply("42", 7, SPAN, 3_538_588_388, "a follow-up"),
    ).resolves.toEqual({ kind: "posted", commentId: 3_600_000_001 });
    expect(apiFetchMock).toHaveBeenCalledWith(
      `/api/repos/42/pulls/7/comments/3538588388/replies?${SPAN_QUERY}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "a follow-up" }),
      },
    );
  });

  it("returns the wrapping review id when the API reports one", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ commentId: 9, reviewId: 555 }), {
        status: 201,
      }),
    );
    await expect(postConversationReply("42", 7, SPAN, 1, "x")).resolves.toEqual(
      { kind: "posted", commentId: 9, reviewId: 555 },
    );
  });

  it("throws typed on an unsafe review id", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ commentId: 9, reviewId: "555" }), {
        status: 201,
      }),
    );
    await expect(
      postConversationReply("42", 7, SPAN, 1, "x"),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("maps expected failures to result kinds", async () => {
    for (const [status, kind] of [
      [401, "unauthorized"],
      [404, "not-found"],
      [400, "invalid"],
      [502, "upstream"],
    ] as const) {
      apiFetchMock.mockResolvedValue(new Response("{}", { status }));
      await expect(
        postConversationReply("42", 7, SPAN, 1, "x"),
      ).resolves.toEqual({
        kind,
      });
    }
  });

  it("maps every previously-swallowed coded failure deliberately", async () => {
    for (const [code, kind] of [
      // Deterministic 413: an over-long reply body; retry-as-is never clears.
      ["request-too-large", "invalid"],
      ["forbidden", "upstream"],
      ["github-permission", "upstream"],
      ["scope-exceeded", "upstream"],
      ["human-only", "upstream"],
      ["pr-changed-since-read", "upstream"],
      ["github-unavailable", "upstream"],
      ["internal-error", "upstream"],
    ] as const) {
      apiFetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: "refused", code }), {
          status: 502,
        }),
      );
      await expect(
        postConversationReply("42", 7, SPAN, 1, "x"),
      ).resolves.toEqual({
        kind,
      });
    }
  });

  it("throws typed on a malformed 2xx", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), { status: 201 }),
    );
    await expect(
      postConversationReply("42", 7, SPAN, 1, "x"),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
