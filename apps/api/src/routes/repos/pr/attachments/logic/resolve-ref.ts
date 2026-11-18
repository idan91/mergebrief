import {
  QualifiedRefNamespaces,
  readQualifiedRef,
} from "brief-core/media-address";
import type { Result } from "types/utils";
import { SOURCES_TTL_MS } from "../consts";
import { buildTransportError } from "./upstream-response";
import {
  ReadAttachmentFailureKinds,
  type CommittedFileLocation,
  type CommittedLookupKey,
  type CommittedRefQuery,
  type CommittedRefRequest,
  type CommittedRefsStore,
  type CommittedViewerKey,
  type ReadAttachmentFailure,
} from "../types";

type LocationResult = Result<CommittedFileLocation, ReadAttachmentFailure>;

const FULL_SHA = /^[0-9a-f]{40}$/i;
const CONTEXT = "committed file refs";
const ALL_NAMESPACES = Object.values(QualifiedRefNamespaces);

/** One matching-refs lookup, and the `refs/<namespace>` segments its names sit under in the path. */
interface RefLookup {
  readonly query: CommittedRefQuery;
  readonly qualifier: readonly string[];
  readonly cacheKey: CommittedLookupKey;
}

function isRefPrefix(
  refSegments: readonly string[],
  pathSegments: readonly string[],
): boolean {
  const leavesFile = refSegments.length < pathSegments.length;
  return (
    leavesFile &&
    refSegments.every((segment, index) => segment === pathSegments[index])
  );
}

/**
 * The longest ref that prefixes the path at a segment boundary and leaves a
 * file after it; with none, the first `minRefSegments`, which GitHub may
 * still read as a short sha or answer not found.
 */
export function pickCommittedFileLocation(
  refNames: readonly string[],
  pathSegments: readonly string[],
  minRefSegments = 1,
): CommittedFileLocation {
  let refLength = minRefSegments;
  for (const name of refNames) {
    const refSegments = name.split("/");
    if (
      refSegments.length > refLength &&
      isRefPrefix(refSegments, pathSegments)
    ) {
      refLength = refSegments.length;
    }
  }
  return {
    ref: pathSegments.slice(0, refLength).join("/"),
    fileSegments: pathSegments.slice(refLength),
  };
}

/** A `refs/heads/...` or `refs/tags/...` path asks its own namespace; a bare ref asks both. */
function readRefLookup(
  viewerKey: CommittedViewerKey,
  pathSegments: readonly string[],
): RefLookup {
  const qualified = readQualifiedRef(pathSegments);
  if (qualified === undefined) {
    const [prefix = ""] = pathSegments;
    const query = { prefix, namespaces: ALL_NAMESPACES };
    return { query, qualifier: [], cacheKey: `${viewerKey}:${prefix}` };
  }

  const [prefix = ""] = qualified.unqualifiedSegments;
  const query = { prefix, namespaces: [qualified.namespace] };
  const qualifier = pathSegments.slice(
    0,
    -qualified.unqualifiedSegments.length,
  );
  const qualifiedPrefix = [...qualifier, prefix].join("/");
  const cacheKey: CommittedLookupKey = `${viewerKey}:${qualifiedPrefix}`;
  return { query, qualifier, cacheKey };
}

function pickLocation(
  lookup: RefLookup,
  refNames: readonly string[],
  pathSegments: readonly string[],
): CommittedFileLocation {
  const names = refNames.map((name) => [...lookup.qualifier, name].join("/"));
  const minRefSegments = lookup.qualifier.length + 1;
  return pickCommittedFileLocation(names, pathSegments, minRefSegments);
}

type RefNamesResult = Awaited<ReturnType<CommittedRefRequest["listRefs"]>>;

/** One lookup per key at a time, cached once it answers whoever still waits on it. */
function listRefsOnce(
  store: CommittedRefsStore,
  request: CommittedRefRequest,
  lookup: RefLookup,
): Promise<RefNamesResult> {
  const running = store.inFlight.get(lookup.cacheKey);
  if (running !== undefined) {
    return running;
  }
  const pending = request
    .listRefs(lookup.query)
    .then((listed) => {
      if (listed.ok) {
        const expiresAt = Date.now() + SOURCES_TTL_MS;
        store.cache.set(lookup.cacheKey, listed.value, expiresAt);
      }
      return listed;
    })
    .finally(() => {
      store.inFlight.delete(lookup.cacheKey);
    });
  store.inFlight.set(lookup.cacheKey, pending);
  return pending;
}

/** The shared lookup's answer, or a transport failure as soon as this read's own client leaves. */
function waitWhileClientStays(
  pending: Promise<RefNamesResult>,
  signal: AbortSignal,
): Promise<RefNamesResult> {
  const kind = ReadAttachmentFailureKinds.GITHUB_DENIED;
  const left: RefNamesResult = {
    ok: false,
    error: { kind, error: buildTransportError(CONTEXT) },
  };
  if (signal.aborted) {
    return Promise.resolve(left);
  }
  return new Promise((resolve, reject) => {
    function stopWaiting(): void {
      resolve(left);
    }
    signal.addEventListener("abort", stopWaiting, { once: true });
    pending.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", stopWaiting);
    });
  });
}

/** Where the ref ends: a full sha as written, else the refs matching the ref's first segment, cached per key. */
export async function resolveCommittedFileLocation(
  store: CommittedRefsStore,
  request: CommittedRefRequest,
): Promise<LocationResult> {
  const { pathSegments } = request;
  const [firstSegment = ""] = pathSegments;
  if (FULL_SHA.test(firstSegment)) {
    return { ok: true, value: pickCommittedFileLocation([], pathSegments) };
  }

  const lookup = readRefLookup(request.viewerKey, pathSegments);
  const cached = store.cache.get(lookup.cacheKey);
  if (cached !== undefined) {
    return { ok: true, value: pickLocation(lookup, cached, pathSegments) };
  }

  const pending = listRefsOnce(store, request, lookup);
  const listed = await waitWhileClientStays(pending, request.signal);
  if (!listed.ok) {
    return listed;
  }
  return { ok: true, value: pickLocation(lookup, listed.value, pathSegments) };
}
