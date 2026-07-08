// Reply transport (BRIEF-25): expected failure statuses are result kinds
// the composer renders — never throws for those; a malformed 2xx throws
// typed (contract violation).
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../data/apiFetch";

vi.mock("../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from "../../data/apiFetch";
import { postConversationReply } from "./reply";

const apiFetchMock = vi.mocked(apiFetch);

describe("postConversationReply", () => {
  it("posts the body to the thread's root comment and returns the created id", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ commentId: 3_600_000_001 }), {
        status: 201,
      }),
    );
    await expect(
      postConversationReply("42", 7, 3_538_588_388, "a follow-up"),
    ).resolves.toEqual({ kind: "posted", commentId: 3_600_000_001 });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/repos/42/pulls/7/comments/3538588388/replies",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "a follow-up" }),
      },
    );
  });

  it("maps expected failures to result kinds", async () => {
    for (const [status, kind] of [
      [401, "unauthorized"],
      [404, "not-found"],
      [400, "invalid"],
      [502, "upstream"],
    ] as const) {
      apiFetchMock.mockResolvedValue(new Response("{}", { status }));
      await expect(postConversationReply("42", 7, 1, "x")).resolves.toEqual({
        kind,
      });
    }
  });

  it("throws typed on a malformed 2xx", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), { status: 201 }),
    );
    await expect(postConversationReply("42", 7, 1, "x")).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
