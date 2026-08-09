// Thread-resolution transport: expected failure statuses are result kinds the
// affordances render — never throws for those. The 403 is its OWN kind
// (GitHub refused a viewer who looked capable), not a 404-style miss.
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../data/apiFetch";

vi.mock("../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn() };
});

import { apiFetch, ApiError } from "../../data/apiFetch";
import { setThreadResolution } from "./resolve";

const apiFetchMock = vi.mocked(apiFetch);

function body(resolved: boolean, alreadyInTargetState = false): Response {
  return new Response(JSON.stringify({ resolved, alreadyInTargetState }), {
    status: 200,
  });
}

describe("setThreadResolution", () => {
  it("posts to the resolve path and reports the flipped state", async () => {
    apiFetchMock.mockResolvedValue(body(true));
    await expect(
      setThreadResolution("42", 7, 3_538_588_388, true),
    ).resolves.toEqual({
      kind: "done",
      resolved: true,
      alreadyInTargetState: false,
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/repos/42/pulls/7/comments/3538588388/resolve",
      { method: "POST" },
    );
  });

  it("posts to the unresolve path for the other direction", async () => {
    apiFetchMock.mockResolvedValue(body(false));
    await expect(setThreadResolution("42", 7, 9001, false)).resolves.toEqual({
      kind: "done",
      resolved: false,
      alreadyInTargetState: false,
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/repos/42/pulls/7/comments/9001/unresolve",
      { method: "POST" },
    );
  });

  it("treats convergence as success, carrying the already-in-state flag", async () => {
    apiFetchMock.mockResolvedValue(body(true, true));
    await expect(setThreadResolution("42", 7, 9001, true)).resolves.toEqual({
      kind: "done",
      resolved: true,
      alreadyInTargetState: true,
    });
  });

  it("maps expected failures to result kinds, 403 to its own", async () => {
    for (const [status, kind] of [
      [401, "unauthorized"],
      [403, "github-permission"],
      [404, "not-found"],
      [400, "invalid"],
      [502, "upstream"],
      [500, "upstream"],
    ] as const) {
      apiFetchMock.mockResolvedValue(new Response("{}", { status }));
      await expect(setThreadResolution("42", 7, 9001, true)).resolves.toEqual({
        kind,
      });
    }
  });

  it("throws typed on a malformed 200", async () => {
    for (const shape of [
      { nope: true },
      { resolved: true },
      { resolved: "true", alreadyInTargetState: false },
      { resolved: true, alreadyInTargetState: "no" },
    ]) {
      apiFetchMock.mockResolvedValue(
        new Response(JSON.stringify(shape), { status: 200 }),
      );
      await expect(
        setThreadResolution("42", 7, 9001, true),
      ).rejects.toBeInstanceOf(ApiError);
    }
  });

  it("throws typed on a non-JSON 200", async () => {
    apiFetchMock.mockResolvedValue(new Response("not json", { status: 200 }));
    await expect(
      setThreadResolution("42", 7, 9001, true),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("throws typed when the echoed direction contradicts the request", async () => {
    // The route echoes the direction it applied; a mismatch means the FE would
    // render a state the server never set — a contract violation, not data.
    apiFetchMock.mockResolvedValue(body(false));
    await expect(
      setThreadResolution("42", 7, 9001, true),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
