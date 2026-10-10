// Every deterministic route rejection maps to recoverable copy (the FE
// resubmits the same state); the 503 config path surfaces the server-authored
// env-name copy verbatim.
import { describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../../data/apiFetch", async (importOriginal) => ({
  ...(await importOriginal()),
  apiFetch,
}));

const { generateBriefViaApi } = await import("./queries");

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("generateBriefViaApi", () => {
  it("posts the url and returns the repo-route coords", async () => {
    apiFetch.mockResolvedValue(
      jsonResponse({ repoId: "424242", prNumber: 7 }, 200),
    );
    await expect(
      generateBriefViaApi("https://github.com/o/r/pull/7"),
    ).resolves.toEqual({ repoId: "424242", prNumber: 7 });
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
    [502, "github-unavailable"],
  ])("preserves wire code %s as a typed error", async (status, code) => {
    apiFetch.mockResolvedValue(jsonResponse({ error: "x", code }, status));
    await expect(generateBriefViaApi("u")).rejects.toMatchObject({
      status,
      code,
    });
  });

  it("falls back to generic copy on a malformed 200", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ nope: true }, 200));
    await expect(generateBriefViaApi("u")).rejects.toMatchObject({
      code: "malformed",
    });
  });
});
