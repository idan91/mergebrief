// Every deterministic route rejection maps to recoverable copy (the FE
// resubmits the same state); the 503 config path surfaces the server-authored
// env-name copy verbatim.
import type { GenerateBriefResponse } from "contract";
import type { Equals } from "types/utils";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod/v4";

import type { ReadsWireFields } from "@web/test/wire-fields";
import type { generateBriefResponseSchema } from "./model/schemas";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../../data/apiFetch", async (importOriginal) => ({
  ...(await importOriginal()),
  apiFetch,
}));

const { generateBriefViaApi } = await import("./queries");

const generateResponsePin = true satisfies Equals<
  z.output<typeof generateBriefResponseSchema>,
  GenerateBriefResponse
>;

const readsWireFieldsPin = true satisfies ReadsWireFields<
  z.input<typeof generateBriefResponseSchema>,
  GenerateBriefResponse
>;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("generateBriefViaApi", () => {
  it("posts the url and returns the coords from the 202", async () => {
    apiFetch.mockResolvedValue(
      jsonResponse({ repoId: "424242", prNumber: 7 }, 202),
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

  it("falls back to generic copy on a malformed 202", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ nope: true }, 202));
    await expect(generateBriefViaApi("u")).rejects.toMatchObject({
      code: "malformed",
    });
  });

  it("pins the parser to the contract receipt", () => {
    expect(generateResponsePin).toBe(true);
  });

  it("reads only the fields the contract sends", () => {
    expect(readsWireFieldsPin).toBe(true);
  });

  it("refuses a 202 whose prNumber is not a number", async () => {
    apiFetch.mockResolvedValue(
      jsonResponse({ repoId: "424242", prNumber: "7" }, 202),
    );
    await expect(generateBriefViaApi("u")).rejects.toMatchObject({
      code: "malformed",
    });
  });
});
