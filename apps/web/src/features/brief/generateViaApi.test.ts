// Every deterministic route rejection maps to recoverable copy (the FE
// resubmits the same state); the 503 config path surfaces the server-authored
// env-name copy verbatim.
import { describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../../data/apiFetch", async (importOriginal) => ({
  ...(await importOriginal()),
  apiFetch,
}));
// The server-fn module is irrelevant here and must not load its
// createServerFn graph into a node test.
vi.mock("./server/brief.functions", () => ({
  getLocalBrief: vi.fn(),
  getLocalBriefs: vi.fn(),
  getLocalComparisonMarks: vi.fn(),
  getLocalRevisionChanges: vi.fn(),
  getLocalRevisionNarrative: vi.fn(),
}));

const { generateBriefViaApi } = await import("./queries");

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("generateBriefViaApi", () => {
  it("posts the url and returns the briefId", async () => {
    apiFetch.mockResolvedValue(
      jsonResponse({ briefId: "o-r-7_1_aaaa1111" }, 200),
    );
    await expect(
      generateBriefViaApi("https://github.com/o/r/pull/7"),
    ).resolves.toBe("o-r-7_1_aaaa1111");
    expect(apiFetch).toHaveBeenCalledWith("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://github.com/o/r/pull/7" }),
    });
  });

  it.each([
    [400, "not-a-pr-url"],
    [401, "unauthorized"],
    [404, "not-found"],
    [502, "generation-failed"],
  ])("preserves wire code %s as a typed error", async (status, code) => {
    apiFetch.mockResolvedValue(jsonResponse({ error: "x", code }, status));
    await expect(generateBriefViaApi("u")).rejects.toMatchObject({
      status,
      code,
    });
  });

  it("surfaces the server-authored 503 config copy", async () => {
    apiFetch.mockResolvedValue(
      jsonResponse(
        {
          error: "ANTHROPIC_API_KEY is required",
          code: "generation-config",
          params: { detail: "ANTHROPIC_API_KEY is required" },
        },
        503,
      ),
    );
    await expect(generateBriefViaApi("u")).rejects.toMatchObject({
      code: "generation-config",
      params: { detail: "ANTHROPIC_API_KEY is required" },
    });
  });

  it("falls back to generic copy on a malformed 200", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ nope: true }, 200));
    await expect(generateBriefViaApi("u")).rejects.toMatchObject({
      code: "malformed",
    });
  });
});
