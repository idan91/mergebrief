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

true satisfies Equals<
  z.output<typeof generateBriefResponseSchema>,
  GenerateBriefResponse
>;

true satisfies ReadsWireFields<
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

  it("falls back to generic copy on a malformed 202", async () => {
    apiFetch.mockResolvedValue(jsonResponse({ nope: true }, 202));
    await expect(generateBriefViaApi("u")).rejects.toMatchObject({
      code: "malformed",
    });
  });
});
