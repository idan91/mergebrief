// Inline post-now transport: expected failure statuses are result kinds the
// own-draft flow renders, never throws for those; a malformed 2xx throws typed
// as a contract violation.
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../../data/apiFetch";

vi.mock("../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from "../../../data/apiFetch";
import { postInlineComment, type PostCommentPayload } from "./postComment";

const apiFetchMock = vi.mocked(apiFetch);

const SPAN = { base: "b".repeat(40), head: "a".repeat(40) };
const PAYLOAD: PostCommentPayload = { draftId: "9001" };
const PATH = `/api/repos/42/pulls/7/comments?base=${SPAN.base}&head=${SPAN.head}`;

describe("postInlineComment", () => {
  it("posts the payload to the PR comments endpoint and returns both ids", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ commentId: 3_600_000_001, reviewId: 42 }), {
        status: 201,
      }),
    );
    await expect(postInlineComment("42", 7, SPAN, PAYLOAD)).resolves.toEqual({
      kind: "posted",
      commentId: 3_600_000_001,
      reviewId: 42,
    });
    expect(apiFetchMock).toHaveBeenCalledWith(PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(PAYLOAD),
    });
  });

  it("returns posted without reviewId when GitHub assigned none", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ commentId: 5 }), { status: 201 }),
    );
    await expect(postInlineComment("42", 7, SPAN, PAYLOAD)).resolves.toEqual({
      kind: "posted",
      commentId: 5,
    });
  });

  it("maps expected failures to result kinds, 409 stale included", async () => {
    for (const [status, kind] of [
      [401, "unauthorized"],
      [404, "not-found"],
      [409, "stale"],
      [400, "invalid"],
      [502, "upstream"],
    ] as const) {
      apiFetchMock.mockResolvedValue(new Response("{}", { status }));
      await expect(postInlineComment("42", 7, SPAN, PAYLOAD)).resolves.toEqual({
        kind,
      });
    }
  });

  it("gives each newly reachable 409 code its own kind, never stale", async () => {
    for (const [code, kind] of [
      ["draft-anchor-orphaned", "orphaned-anchor"],
      ["draft-already-published", "already-published"],
    ] as const) {
      apiFetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: "conflict", code }), {
          status: 409,
        }),
      );
      await expect(postInlineComment("42", 7, SPAN, PAYLOAD)).resolves.toEqual({
        kind,
      });
    }
  });

  it("maps both wire 409 codes to stale on the production path", async () => {
    for (const code of ["pr-changed-since-read", "pr-rewritten-since-read"]) {
      apiFetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: "conflict", code }), {
          status: 409,
        }),
      );
      await expect(postInlineComment("42", 7, SPAN, PAYLOAD)).resolves.toEqual({
        kind: "stale",
      });
    }
  });

  it("maps every previously-swallowed coded failure deliberately", async () => {
    for (const [code, kind] of [
      // Deterministic 413: the body is too long; retrying as-is never clears
      // it. `invalid` copy says edit the draft, the only honest advice.
      ["request-too-large", "invalid"],
      ["forbidden", "upstream"],
      ["scope-exceeded", "upstream"],
      ["human-only", "upstream"],
      ["draft-limit-reached", "upstream"],
      ["app-not-installed", "upstream"],
      ["github-unavailable", "upstream"],
      ["internal-error", "upstream"],
    ] as const) {
      apiFetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: "refused", code }), {
          status: 502,
        }),
      );
      await expect(postInlineComment("42", 7, SPAN, PAYLOAD)).resolves.toEqual({
        kind,
      });
    }
  });

  it("maps a github-permission 403 to its own kind, never upstream", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ error: "forbidden", code: "github-permission" }),
        { status: 403 },
      ),
    );
    await expect(postInlineComment("42", 7, SPAN, PAYLOAD)).resolves.toEqual({
      kind: "github-permission",
    });
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
      await expect(postInlineComment("42", 7, SPAN, PAYLOAD)).resolves.toEqual({
        kind,
      });
    }
  });

  it("throws typed on a malformed 2xx", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), { status: 201 }),
    );
    await expect(
      postInlineComment("42", 7, SPAN, PAYLOAD),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
