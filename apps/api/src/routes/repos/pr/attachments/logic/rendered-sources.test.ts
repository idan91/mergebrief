import { isAttachmentAssetId, type AttachmentAssetId } from "contract";
import { RenewalFailureCodes, type RepoReader } from "github";
import { makeFakeGitHub, type FakeGitHub } from "github/testing";
import type { Logger } from "logging";
import { isRepoId } from "persistence";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTtlCache } from "../../../../ttl-cache";
import type { RenderedSources, RenderedSourcesStore } from "../types";
import {
  listRenderedVideoAssetIds,
  resolveRenderedSource,
} from "./rendered-sources";

const REPO = { owner: "octo", repo: "hello" };
const PR_NUMBER = 7;
const CACHE_KEY = "hash:424242:7";
const ASSET = "3e5dffc4-bd05-4a01-98e8-1c519ba4cf00";
const OTHER_ASSET = "96abe080-db23-4366-9eb8-32a76d148ae5";
const SIGNED_URL = `https://private-user-images.githubusercontent.com/1/2-${ASSET}.png?jwt=abc`;
const PUBLIC_URL = `https://github.com/user-attachments/assets/${OTHER_ASSET}`;
const AN_HOUR_MS = 60 * 60_000;

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

function requireAssetId(value: string): AttachmentAssetId {
  if (!isAttachmentAssetId(value)) {
    throw new Error("fixture asset id failed its guard");
  }
  return value;
}

function arrangeSources(
  fake: FakeGitHub,
  imageSources: readonly string[],
  videoSources: readonly string[] = [],
) {
  const repoId = 424242n;
  if (!isRepoId(repoId)) {
    throw new Error("fixture repo id failed its guard");
  }
  fake.addPullRequest(
    { ...REPO, prNumber: PR_NUMBER },
    {
      imageSources,
      videoSources,
      info: {
        repoId,
        repoFullName: "octo/hello",
        headSha: "h".repeat(40),
        headRef: "feature",
        baseSha: "b".repeat(40),
        state: "open",
        draft: false,
        merged: false,
        title: "A pull request",
        body: "",
        htmlUrl: "https://github.com/octo/hello/pull/7",
        commitCount: 1,
        changedFiles: 1,
        additions: 8,
        deletions: 2,
        labels: [],
        pendingReviewRequests: 0,
        authorLogin: "octocat",
        authorIsBot: false,
        closedAt: null,
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        createdAt: new Date("2025-12-01T00:00:00Z"),
      },
    },
  );
}

function bindReader(fake: FakeGitHub): RepoReader {
  const credential = {
    readToken: async () => ({ ok: true, value: "ghu_viewer" }) as const,
    renewToken: async () =>
      ({ ok: false, error: { code: RenewalFailureCodes.REFUSED } }) as const,
  };
  return fake.bindReviewerGitHub(credential, { log }).forRepo(REPO);
}

describe("resolveRenderedSource", () => {
  let fake: FakeGitHub;
  let store: RenderedSourcesStore;

  beforeEach(() => {
    fake = makeFakeGitHub();
    store = {
      cache: createTtlCache<RenderedSources>(10),
      inFlight: new Map(),
    };
  });

  function resolve(assetId: string) {
    return resolveRenderedSource(store, {
      cacheKey: CACHE_KEY,
      reader: bindReader(fake),
      prNumber: PR_NUMBER,
      assetId: requireAssetId(assetId),
    });
  }

  function cacheSources(imageSources: readonly string[], fetchedAt: number) {
    const sources = { imageSources, videoSources: [] };
    const entry = { sources, fetchedAt, readForMissingAsset: false };
    store.cache.set(CACHE_KEY, entry, Date.now() + AN_HOUR_MS);
  }

  it("refetches the sources when an old entry lacks the asset", async () => {
    arrangeSources(fake, [SIGNED_URL]);
    cacheSources([], Date.now() - 60_000);

    const resolved = await resolve(ASSET);

    expect(resolved).toEqual({ ok: true, value: SIGNED_URL });
    expect(fake.listCalls("fetchRenderedMediaSources")).toHaveLength(1);
  });

  it("resolves an asset GitHub rendered as a video", async () => {
    const video = SIGNED_URL.replace(".png", ".mp4");
    arrangeSources(fake, [], [video]);

    const resolved = await resolve(ASSET);

    expect(resolved).toEqual({ ok: true, value: video });
  });

  it("answers absent without github when a young entry lacks the asset", async () => {
    arrangeSources(fake, [SIGNED_URL]);
    cacheSources([], Date.now());

    const resolved = await resolve(ASSET);

    expect(resolved).toEqual({ ok: false, error: { kind: "asset-absent" } });
    expect(fake.calls).toEqual([]);
  });

  it("shares one github call across assets requested together", async () => {
    arrangeSources(fake, [SIGNED_URL, PUBLIC_URL]);

    const [first, second] = await Promise.all([
      resolve(ASSET),
      resolve(OTHER_ASSET),
    ]);

    expect(first.ok && second.ok).toBe(true);
    expect(fake.listCalls("fetchRenderedMediaSources")).toHaveLength(1);
    expect(store.inFlight.size).toBe(0);
  });
});

describe("listRenderedVideoAssetIds", () => {
  let fake: FakeGitHub;
  let store: RenderedSourcesStore;
  const video = SIGNED_URL.replace(".png", ".mp4");

  beforeEach(() => {
    fake = makeFakeGitHub();
    store = {
      cache: createTtlCache<RenderedSources>(10),
      inFlight: new Map(),
    };
  });

  function list(missingAssetId?: AttachmentAssetId) {
    const request = {
      cacheKey: CACHE_KEY,
      reader: bindReader(fake),
      prNumber: PR_NUMBER,
    };
    return listRenderedVideoAssetIds(store, request, missingAssetId);
  }

  function cacheVideos(videoSources: readonly string[], fetchedAt: number) {
    const sources = { imageSources: [], videoSources };
    const entry = { sources, fetchedAt, readForMissingAsset: false };
    store.cache.set(CACHE_KEY, entry, Date.now() + AN_HOUR_MS);
  }

  it("answers from a young entry without github", async () => {
    cacheVideos([video], Date.now());

    expect(await list()).toEqual({ ok: true, value: [ASSET] });
    expect(fake.calls).toEqual([]);
  });

  it("refetches an older entry, a video posted since may be missing", async () => {
    arrangeSources(fake, [], [video]);
    cacheVideos([], Date.now() - 60_000);

    expect(await list()).toEqual({ ok: true, value: [ASSET] });
    expect(fake.listCalls("fetchRenderedMediaSources")).toHaveLength(1);
  });

  it("re-reads a young entry once for a video id it lacks", async () => {
    const later = SIGNED_URL.replace(ASSET, OTHER_ASSET).replace(
      ".png",
      ".mp4",
    );
    arrangeSources(fake, [], [video, later]);
    cacheVideos([video], Date.now());

    const answered = await list(requireAssetId(OTHER_ASSET));

    expect(answered).toEqual({ ok: true, value: [ASSET, OTHER_ASSET] });
    expect(fake.listCalls("fetchRenderedMediaSources")).toHaveLength(1);
  });

  it("answers a second miss from the entry the first one read", async () => {
    arrangeSources(fake, [], [video]);
    cacheVideos([], Date.now());

    await list(requireAssetId(ASSET));
    const second = await list(requireAssetId(OTHER_ASSET));

    expect(second).toEqual({ ok: true, value: [ASSET] });
    expect(fake.listCalls("fetchRenderedMediaSources")).toHaveLength(1);
  });

  it("answers a young entry holding the asked id without github", async () => {
    cacheVideos([video], Date.now());

    expect(await list(requireAssetId(ASSET))).toEqual({
      ok: true,
      value: [ASSET],
    });
    expect(fake.calls).toEqual([]);
  });
});
