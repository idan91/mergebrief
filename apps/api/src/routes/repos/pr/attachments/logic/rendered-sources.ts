import type { Result } from "types/utils";
import { SOURCES_REFETCH_MIN_AGE_MS, SOURCES_TTL_MS } from "../consts";
import {
  ReadAttachmentFailureKinds,
  type ReadAttachmentFailure,
  type RenderedSourceRequest,
  type RenderedSources,
  type RenderedSourcesStore,
} from "../types";
import { resolveAttachmentSource } from "./resolve-source";

type SourcesResult = Result<RenderedSources, ReadAttachmentFailure>;

const ASSET_ABSENT = {
  ok: false,
  error: { kind: ReadAttachmentFailureKinds.ASSET_ABSENT },
} as const;

async function fetchSources(
  request: RenderedSourceRequest,
): Promise<SourcesResult> {
  const fetched = await request.reader.fetchRenderedImageSources(
    request.prNumber,
  );
  if (!fetched.ok) {
    const kind = ReadAttachmentFailureKinds.GITHUB_DENIED;
    return { ok: false, error: { kind, error: fetched.error } };
  }
  return { ok: true, value: { sources: fetched.value, fetchedAt: Date.now() } };
}

/**
 * One GitHub call per key at a time: a cold page fires every <img> at once,
 * and each would otherwise run the whole query before the first could cache.
 */
function fetchSourcesOnce(
  store: RenderedSourcesStore,
  request: RenderedSourceRequest,
): Promise<SourcesResult> {
  const running = store.inFlight.get(request.cacheKey);
  if (running !== undefined) {
    return running;
  }
  const pending = fetchSources(request).finally(() => {
    store.inFlight.delete(request.cacheKey);
  });
  store.inFlight.set(request.cacheKey, pending);
  return pending;
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
    const source = resolveAttachmentSource(cached.sources, request.assetId);
    if (source !== undefined) {
      return { ok: true, value: source };
    }
    const recentlyFetched =
      Date.now() - cached.fetchedAt < SOURCES_REFETCH_MIN_AGE_MS;
    if (recentlyFetched) {
      return ASSET_ABSENT;
    }
  }

  const fresh = await fetchSourcesOnce(store, request);
  if (!fresh.ok) {
    return fresh;
  }
  const expiresAt = fresh.value.fetchedAt + SOURCES_TTL_MS;
  store.cache.set(request.cacheKey, fresh.value, expiresAt);

  const source = resolveAttachmentSource(fresh.value.sources, request.assetId);
  if (source === undefined) {
    return ASSET_ABSENT;
  }
  return { ok: true, value: source };
}
