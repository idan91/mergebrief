import type { AttachmentAssetId } from "contract";
import type { RepositoryRef } from "github";
import type { Result } from "types/utils";
import type { RepoAccess } from "../../../../../access/types";
import { SOURCES_REFETCH_MIN_AGE_MS, SOURCES_TTL_MS } from "../consts";
import {
  ReadAttachmentFailureKinds,
  type ReadAttachmentFailure,
  type ReadAttachmentWireFailure,
  type RenderedSourceRequest,
  type RenderedSources,
  type RenderedSourcesRequest,
  type RenderedSourcesStore,
} from "../types";
import { readRenderedAssetId, resolveAttachmentSource } from "./resolve-source";

type SourcesResult = Result<RenderedSources, ReadAttachmentWireFailure>;

const ASSET_ABSENT = {
  ok: false,
  error: { kind: ReadAttachmentFailureKinds.ASSET_ABSENT },
} as const;

/** An asset GitHub rendered as an image or as a video. */
function resolveRenderedAssetSource(
  rendered: RenderedSources,
  assetId: AttachmentAssetId,
): string | undefined {
  const { imageSources, videoSources } = rendered.sources;
  return resolveAttachmentSource([...imageSources, ...videoSources], assetId);
}

async function fetchSources(
  request: RenderedSourcesRequest,
  readForMissingAsset: boolean,
): Promise<SourcesResult> {
  const fetched = await request.reader.fetchRenderedMediaSources(
    request.prNumber,
  );
  if (!fetched.ok) {
    const kind = ReadAttachmentFailureKinds.GITHUB_DENIED;
    return { ok: false, error: { kind, error: fetched.error } };
  }
  const sources = fetched.value;
  const value = { sources, fetchedAt: Date.now(), readForMissingAsset };
  return { ok: true, value };
}

/**
 * One GitHub call per key at a time: a cold page fires every <img> at once,
 * and each would otherwise run the whole query before the first could cache.
 */
function fetchSourcesOnce(
  store: RenderedSourcesStore,
  request: RenderedSourcesRequest,
  readForMissingAsset: boolean,
): Promise<SourcesResult> {
  const running = store.inFlight.get(request.cacheKey);
  if (running !== undefined) {
    return running;
  }
  const pending = fetchSources(request, readForMissingAsset).finally(() => {
    store.inFlight.delete(request.cacheKey);
  });
  store.inFlight.set(request.cacheKey, pending);
  return pending;
}

async function fetchAndCacheSources(
  store: RenderedSourcesStore,
  request: RenderedSourcesRequest,
  readForMissingAsset = false,
): Promise<SourcesResult> {
  const fresh = await fetchSourcesOnce(store, request, readForMissingAsset);
  if (fresh.ok) {
    const expiresAt = fresh.value.fetchedAt + SOURCES_TTL_MS;
    store.cache.set(request.cacheKey, fresh.value, expiresAt);
  }
  return fresh;
}

function isRecentlyFetched(rendered: RenderedSources): boolean {
  return Date.now() - rendered.fetchedAt < SOURCES_REFETCH_MIN_AGE_MS;
}

function readVideoAssetIds(
  rendered: RenderedSources,
): ReadonlySet<AttachmentAssetId> {
  const assetIds = new Set<AttachmentAssetId>();
  for (const source of rendered.sources.videoSources) {
    const assetId = readRenderedAssetId(source);
    if (assetId !== undefined) {
      assetIds.add(assetId);
    }
  }
  return assetIds;
}

/** A young entry lacks the page's missing id and no read has yet been spent on a miss inside it. */
function needsMissingAssetRead(
  cached: RenderedSources,
  missingAssetId: AttachmentAssetId | undefined,
): boolean {
  if (missingAssetId === undefined || cached.readForMissingAsset) {
    return false;
  }
  return !readVideoAssetIds(cached).has(missingAssetId);
}

/**
 * The cached entry while it is young, else a fresh read. A young entry
 * lacking the page's missing id is read past once; that read answers every
 * later miss until it ages, so a page cannot turn misses into GitHub calls.
 */
async function readRecentSources(
  store: RenderedSourcesStore,
  request: RenderedSourcesRequest,
  missingAssetId: AttachmentAssetId | undefined,
): Promise<SourcesResult> {
  const cached = store.cache.get(request.cacheKey);
  if (cached === undefined || !isRecentlyFetched(cached)) {
    return fetchAndCacheSources(store, request);
  }
  if (needsMissingAssetRead(cached, missingAssetId)) {
    return fetchAndCacheSources(store, request, true);
  }
  return { ok: true, value: cached };
}

/** The sources cached per viewer and PR, and the GitHub reader they are read on. */
export function buildRenderedSourcesRequest(
  access: RepoAccess,
  repo: RepositoryRef,
  prNumber: number,
): RenderedSourcesRequest {
  const sessionTokenHash = access.session.sessionTokenHash;
  const cacheKey = `${sessionTokenHash}:${String(access.repoId)}:${prNumber}`;
  return { cacheKey, reader: access.github.forRepo(repo), prNumber };
}

/**
 * The rendered URL serving the asset, from sources cached per viewer and PR.
 * A miss inside a live entry refetches, since the screenshot may have been
 * posted after the entry was cached, but only once the entry is old enough:
 * an asset outside the query's windows would otherwise re-run it every render.
 */
export async function resolveRenderedSource(
  store: RenderedSourcesStore,
  request: RenderedSourceRequest,
): Promise<Result<string, ReadAttachmentFailure>> {
  const cached = store.cache.get(request.cacheKey);
  if (cached !== undefined) {
    const source = resolveRenderedAssetSource(cached, request.assetId);
    if (source !== undefined) {
      return { ok: true, value: source };
    }
    if (isRecentlyFetched(cached)) {
      return ASSET_ABSENT;
    }
  }

  const fresh = await fetchAndCacheSources(store, request);
  if (!fresh.ok) {
    return fresh;
  }
  const source = resolveRenderedAssetSource(fresh.value, request.assetId);
  if (source === undefined) {
    return ASSET_ABSENT;
  }
  return { ok: true, value: source };
}

/**
 * Every pasted asset GitHub rendered as a video, once each, in document
 * order. A page asks when it shows a bare asset line, perhaps one posted
 * after the entry was cached, so only an entry young enough to be answered
 * absent by the asset read is reused, and a re-ask naming its missing id
 * reads past that entry once.
 */
export async function listRenderedVideoAssetIds(
  store: RenderedSourcesStore,
  request: RenderedSourcesRequest,
  missingAssetId?: AttachmentAssetId,
): Promise<Result<readonly AttachmentAssetId[], ReadAttachmentWireFailure>> {
  const rendered = await readRecentSources(store, request, missingAssetId);
  if (!rendered.ok) {
    return rendered;
  }
  return { ok: true, value: [...readVideoAssetIds(rendered.value)] };
}
