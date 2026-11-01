import { GitHubApiErrorCodes } from "github";
import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "../../../../ttl-cache";
import type { CommittedRefsStore, CommittedViewerKey } from "../types";
import {
  pickCommittedFileLocation,
  resolveCommittedFileLocation,
} from "./resolve-ref";

const VIEWER_KEY: CommittedViewerKey = "session:1";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const CLIENT = new AbortController().signal;

function makeStore(): CommittedRefsStore {
  return { cache: createTtlCache(10), inFlight: new Map() };
}

function stubListRefs(names: readonly string[]) {
  return vi.fn(async () => ({ ok: true as const, value: names }));
}

describe("pickCommittedFileLocation", () => {
  it("takes the longest ref that prefixes the path at a segment boundary", () => {
    const location = pickCommittedFileLocation(
      ["feature", "feature/x", "feature/xy"],
      ["feature", "x", "docs", "a.png"],
    );

    expect(location).toEqual({
      ref: "feature/x",
      fileSegments: ["docs", "a.png"],
    });
  });

  it("never lets a ref swallow the whole path", () => {
    const location = pickCommittedFileLocation(
      ["main", "main/a.png"],
      ["main", "a.png"],
    );

    expect(location).toEqual({ ref: "main", fileSegments: ["a.png"] });
  });

  it("falls back to the first segment when no ref matches", () => {
    expect(pickCommittedFileLocation([], ["v1.2", "a.png"])).toEqual({
      ref: "v1.2",
      fileSegments: ["a.png"],
    });
  });

  it("ignores a ref that only shares a prefix inside a segment", () => {
    const location = pickCommittedFileLocation(["feat"], ["feature", "a.png"]);

    expect(location).toEqual({ ref: "feature", fileSegments: ["a.png"] });
  });
});

describe("resolveCommittedFileLocation", () => {
  it("uses a full sha as the ref without asking for refs", async () => {
    const listRefs = stubListRefs([]);

    const resolved = await resolveCommittedFileLocation(makeStore(), {
      viewerKey: VIEWER_KEY,
      signal: CLIENT,
      pathSegments: [SHA, "a.png"],
      listRefs,
    });

    expect(resolved).toEqual({
      ok: true,
      value: { ref: SHA, fileSegments: ["a.png"] },
    });
    expect(listRefs).not.toHaveBeenCalled();
  });

  it("splits a slashed branch by the refs the repository holds", async () => {
    const resolved = await resolveCommittedFileLocation(makeStore(), {
      viewerKey: VIEWER_KEY,
      signal: CLIENT,
      pathSegments: ["assets", "brief-362", "after.png"],
      listRefs: stubListRefs(["assets/brief-362"]),
    });

    expect(resolved).toEqual({
      ok: true,
      value: { ref: "assets/brief-362", fileSegments: ["after.png"] },
    });
  });

  it("asks once per key and serves the next read from the cache", async () => {
    const store = makeStore();
    const listRefs = stubListRefs(["feature/x"]);
    const request = {
      viewerKey: VIEWER_KEY,
      signal: CLIENT,
      pathSegments: ["feature", "x", "a.png"],
      listRefs,
    };

    await Promise.all([
      resolveCommittedFileLocation(store, request),
      resolveCommittedFileLocation(store, request),
    ]);
    await resolveCommittedFileLocation(store, request);

    expect(listRefs).toHaveBeenCalledTimes(1);
    expect(store.inFlight.size).toBe(0);
  });

  it("passes a refusal through and caches nothing", async () => {
    const store = makeStore();
    const github = { code: GitHubApiErrorCodes.NOT_FOUND, message: "x" };
    const error = { kind: "github-denied" as const, error: github };
    const listRefs = vi.fn(async () => ({ ok: false as const, error }));
    const request = {
      viewerKey: VIEWER_KEY,
      signal: CLIENT,
      pathSegments: ["main", "a.png"],
      listRefs,
    };

    const resolved = await resolveCommittedFileLocation(store, request);

    expect(resolved).toEqual({ ok: false, error });
    expect(store.cache.get("session:1:main")).toBeUndefined();
  });

  it("asks for both namespaces when the address names a bare ref", async () => {
    const listRefs = stubListRefs(["main"]);

    await resolveCommittedFileLocation(makeStore(), {
      viewerKey: VIEWER_KEY,
      signal: CLIENT,
      pathSegments: ["main", "a.png"],
      listRefs,
    });

    expect(listRefs).toHaveBeenCalledWith({
      prefix: "main",
      namespaces: ["heads", "tags"],
    });
  });

  it("resolves a refs/heads address in the heads namespace only", async () => {
    const listRefs = stubListRefs(["feature", "feature/x"]);

    const resolved = await resolveCommittedFileLocation(makeStore(), {
      viewerKey: VIEWER_KEY,
      signal: CLIENT,
      pathSegments: ["refs", "heads", "feature", "x", "docs", "a.png"],
      listRefs,
    });

    expect(listRefs).toHaveBeenCalledWith({
      prefix: "feature",
      namespaces: ["heads"],
    });
    expect(resolved).toEqual({
      ok: true,
      value: { ref: "refs/heads/feature/x", fileSegments: ["docs", "a.png"] },
    });
  });

  it("keeps the namespace on a refs/tags ref no listed tag matches", async () => {
    const resolved = await resolveCommittedFileLocation(makeStore(), {
      viewerKey: VIEWER_KEY,
      signal: CLIENT,
      pathSegments: ["refs", "tags", "v1", "a.png"],
      listRefs: stubListRefs([]),
    });

    expect(resolved).toEqual({
      ok: true,
      value: { ref: "refs/tags/v1", fileSegments: ["a.png"] },
    });
  });

  it("caches a qualified lookup apart from the bare one", async () => {
    const store = makeStore();
    const listRefs = stubListRefs(["main"]);

    await resolveCommittedFileLocation(store, {
      viewerKey: VIEWER_KEY,
      signal: CLIENT,
      pathSegments: ["refs", "heads", "main", "a.png"],
      listRefs,
    });
    await resolveCommittedFileLocation(store, {
      viewerKey: VIEWER_KEY,
      signal: CLIENT,
      pathSegments: ["main", "a.png"],
      listRefs,
    });

    expect(listRefs).toHaveBeenCalledTimes(2);
  });

  it("lets a caller whose client left stop waiting, the others still served", async () => {
    const store = makeStore();
    let answer: (names: { ok: true; value: readonly string[] }) => void = () =>
      undefined;
    const listRefs = vi.fn(
      () =>
        new Promise<{ ok: true; value: readonly string[] }>((resolve) => {
          answer = resolve;
        }),
    );
    const left = new AbortController();
    const request = {
      viewerKey: VIEWER_KEY,
      pathSegments: ["main", "a.png"],
      listRefs,
    };

    const leaving = resolveCommittedFileLocation(store, {
      ...request,
      signal: left.signal,
    });
    const staying = resolveCommittedFileLocation(store, {
      ...request,
      signal: CLIENT,
    });
    left.abort();

    expect((await leaving).ok).toBe(false);
    answer({ ok: true, value: ["main"] });
    expect(await staying).toEqual({
      ok: true,
      value: { ref: "main", fileSegments: ["a.png"] },
    });
    expect(listRefs).toHaveBeenCalledTimes(1);
  });
});
