// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildViewerQueryOptions } from "./queries";
import { ViewerStates } from "./types";

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

function readViewer() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return client.fetchQuery(buildViewerQueryOptions());
}

describe("buildViewerQueryOptions", () => {
  it("reads the viewer off the session route", async () => {
    answerWith(200, {
      viewer: { login: "octocat", avatarUrl: "https://a/1" },
      operator: true,
    });

    await expect(readViewer()).resolves.toEqual({
      kind: ViewerStates.SIGNED_IN,
      login: "octocat",
      avatarUrl: "https://a/1",
      operator: true,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toMatch(/\/api\/auth\/session$/);
  });

  it("a body without a viewer is unknown, never a throw", async () => {
    answerWith(200, {});

    await expect(readViewer()).resolves.toEqual({
      kind: ViewerStates.UNKNOWN,
    });
  });

  it("a 401 is the signed-out state", async () => {
    answerWith(401, { code: "unauthorized" });

    await expect(readViewer()).resolves.toEqual({
      kind: ViewerStates.SIGNED_OUT,
    });
    expect(assign).not.toHaveBeenCalled();
  });

  it("any other failure throws so the read is retried later", async () => {
    answerWith(503, { code: "github-unavailable" });

    await expect(readViewer()).rejects.toMatchObject({ status: 503 });
  });
});
