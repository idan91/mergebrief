// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../../data/apiFetch";
import { buildVersionQueryOptions } from "./queries";
import { VersionStates } from "./types";
import { resolvePollInterval } from "./utils";

const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { assign, href: "/", hash: "", search: "" });
});

afterEach(() => {
  fetchMock.mockReset();
  assign.mockReset();
  window.sessionStorage.clear();
});

function answerWith(status: number, body: unknown): void {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function readVersion() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return client.fetchQuery(buildVersionQueryOptions());
}

describe("buildVersionQueryOptions", () => {
  it("polls every minute when signed in and never when signed out", () => {
    expect(typeof buildVersionQueryOptions().refetchInterval).toBe("function");
    expect(resolvePollInterval(undefined)).toBe(60_000);
    expect(
      resolvePollInterval({
        kind: VersionStates.KNOWN,
        snapshot: { version: "1.4.0" },
      }),
    ).toBe(60_000);
    expect(resolvePollInterval({ kind: VersionStates.SIGNED_OUT })).toBe(false);
  });

  it("reads the version snapshot off the version route", async () => {
    answerWith(200, {
      version: "1.4.0",
      latest: "1.6.0",
      releaseNotesUrl: "https://example.test/notes",
      checkedAt: "2026-10-03T10:00:00.000Z",
      breaking: true,
      security: false,
      extra: "ignored",
    });

    await expect(readVersion()).resolves.toEqual({
      kind: VersionStates.KNOWN,
      snapshot: {
        version: "1.4.0",
        latest: "1.6.0",
        releaseNotesUrl: "https://example.test/notes",
        checkedAt: "2026-10-03T10:00:00.000Z",
        breaking: true,
        security: false,
      },
    });
  });

  it("keeps a bare version when no check has succeeded", async () => {
    answerWith(200, { version: "dev" });

    await expect(readVersion()).resolves.toEqual({
      kind: VersionStates.KNOWN,
      snapshot: { version: "dev" },
    });
  });

  it("treats a 401 as signed out", async () => {
    answerWith(401, { error: "unauthorized", code: "unauthorized" });

    await expect(readVersion()).resolves.toEqual({
      kind: VersionStates.SIGNED_OUT,
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it("drops a body with no version string", async () => {
    answerWith(200, { latest: "1.6.0" });

    await expect(readVersion()).resolves.toEqual({
      kind: VersionStates.UNKNOWN,
    });
  });

  it("throws on a server failure so the query retries", async () => {
    answerWith(500, { error: "internal", code: "internal-error" });

    await expect(readVersion()).rejects.toBeInstanceOf(ApiError);
  });
});
