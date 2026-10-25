// The regenerate write over realistic wire bodies: the request's own fetch
// boundary is mocked, so the kind table runs end to end.
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../../data/apiFetch";

vi.mock("../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../../data/apiFetch";
import { regenerateBrief } from "./regenerate";
import { answerApiFetch } from "../test-utils";

const apiFetchMock = vi.mocked(apiFetch);

describe("regenerateBrief", () => {
  it("posts to the regenerate route and reads its 202 as queued", async () => {
    answerApiFetch(apiFetchMock, 202);

    await expect(regenerateBrief("424242", 7)).resolves.toEqual({
      kind: "queued",
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/repos/424242/pulls/7/regenerate",
      { method: "POST" },
    );
  });

  it.each([
    ["generation-held", "held"],
    ["generation-not-regenerable", "not-regenerable"],
  ])("maps the 409 %s to the %s kind", async (code, kind) => {
    answerApiFetch(apiFetchMock, 409, code);

    await expect(regenerateBrief("424242", 7)).resolves.toEqual({ kind });
  });

  it.each([
    [404, "not-found", "not-allowed"],
    [403, "scope-exceeded", "not-allowed"],
    [403, "forbidden", "not-allowed"],
    [403, "human-only", "not-allowed"],
    [401, "unauthorized", "unauthorized"],
    [502, "github-unavailable", "upstream"],
    [500, "internal-error", "upstream"],
  ])("maps a %i %s to the %s kind", async (status, code, kind) => {
    answerApiFetch(apiFetchMock, status, code);

    await expect(regenerateBrief("424242", 7)).resolves.toEqual({ kind });
  });

  it("maps a network throw to the indeterminate kind", async () => {
    apiFetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(regenerateBrief("424242", 7)).resolves.toEqual({
      kind: "indeterminate",
    });
  });
});
