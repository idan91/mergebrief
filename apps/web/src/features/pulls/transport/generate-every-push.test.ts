// The every-push writes over realistic wire bodies: the request's own fetch
// boundary is mocked, so the kind table runs end to end.
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../../data/apiFetch";

vi.mock("../../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch } from "../../../data/apiFetch";
import {
  turnOffGenerateEveryPush,
  turnOnGenerateEveryPush,
} from "./generate-every-push";
import { answerApiFetch } from "../test-utils";

const apiFetchMock = vi.mocked(apiFetch);

describe("generate on every push writes", () => {
  it("posts on to its route and reads a 204 as saved", async () => {
    answerApiFetch(apiFetchMock, 204);

    await expect(turnOnGenerateEveryPush("424242", 7)).resolves.toEqual({
      kind: "saved",
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/repos/424242/pulls/7/generate-every-push/on",
      { method: "POST" },
    );
  });

  it("posts off to its own route", async () => {
    answerApiFetch(apiFetchMock, 204);

    await expect(turnOffGenerateEveryPush("424242", 7)).resolves.toEqual({
      kind: "saved",
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/repos/424242/pulls/7/generate-every-push/off",
      { method: "POST" },
    );
  });

  it.each([
    [404, "not-found", "not-allowed"],
    [403, "human-only", "not-allowed"],
    [403, "forbidden", "not-allowed"],
    [403, "account-not-allowed", "account-not-allowed"],
    [401, "unauthorized", "unauthorized"],
    [502, "github-unavailable", "upstream"],
    [500, "internal-error", "upstream"],
  ])("maps a %i %s to the %s kind", async (status, code, kind) => {
    answerApiFetch(apiFetchMock, status, code);

    await expect(turnOnGenerateEveryPush("424242", 7)).resolves.toEqual({
      kind,
    });
  });

  it("maps a network throw to the indeterminate kind", async () => {
    apiFetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(turnOffGenerateEveryPush("424242", 7)).resolves.toEqual({
      kind: "indeterminate",
    });
  });
});
