// A pasted screenshot or a committed image is private to the repo, and the
// browser cannot carry a GitHub login across origins, so the API streams the
// bytes same-origin, where the session cookie rides an <img> or <video>
// request, a video in ranged pieces and never by redirect: a bare id is a
// GitHub asset, found through the URL GitHub rendered for it; `<id>.<ext>` is
// a file on the attachments branch; `committed-file?source=` names any other
// file in the repo by its normalised address. Either read answers a raster's
// strip thumbnail when asked; the upload commits with the App's token.
import { randomUUID } from "node:crypto";
import {
  ApiErrorCodes,
  ATTACHMENT_EXTENSION_BY_MEDIA_TYPE,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_THUMBNAIL_PARAM,
  AttachmentMediaTypes,
  AttachmentSourceKinds,
  isAttachmentAssetId,
  parseAttachmentFileName,
  ProductActionIds,
  ProductQueryIds,
  type AttachmentFile,
  type AttachmentMediaType,
  type AttachmentThumbnail,
  type UploadAttachmentResponse,
  type VideoAssetsResponse,
  VIDEO_ASSETS_MISSING_PARAM,
} from "contract";
import {
  isCommittedFileInRepository,
  parseCommittedFileUrl,
  type CommittedFileSource,
} from "brief-core/media-address";
import type { Context, Handler } from "hono";
import { HttpStatuses } from "types/http";
import { bindGrantedPullRequestGitHub } from "../../../../access/reviewer-binding";
import type { AuthzEnv } from "../../../../access/types";
import {
  productRouter,
  type ProductRouter,
} from "../../../../product-operations/product-router";
import {
  BadRequest,
  NotFound,
  PayloadTooLarge,
  ServiceUnavailable,
  TooManyRequests,
} from "../../../../shared-errors/api-error";
import { readRawBodyWithinLimit } from "../../../read-body";
import { createTtlCache } from "../../../ttl-cache";
import { prNumberSchema } from "../../../wire-bounds";
import { createRepositoryTargetLayer } from "../../logic/repository-target";
import {
  ACCEPT_RANGES_BYTES,
  ATTACHMENT_RESPONSE_HEADERS,
  BYTES_PER_MB,
  COMMITTED_FILE_CACHE_MAX_ENTRIES,
  COMMITTED_LOOKUP_BUDGET_MAX_ENTRIES,
  DEFAULT_COMMITTED_LOOKUP_LIMITS,
  DEFAULT_MEDIA_MAX_MB,
  DEFAULT_UPLOAD_QUOTA_LIMITS,
  MAX_OPEN_MEDIA_STREAMS,
  MAX_RUNNING_RESIZES,
  MAX_WAITING_RESIZES,
  MEDIA_PIECE_BYTES,
  MEDIA_PIECE_DEADLINE_MS,
  MEDIA_SNIFF_WINDOW_BYTES,
  NO_STORE,
  RESIZE_TURN_WAIT_MS,
  RETRY_AFTER_HEADER,
  SOURCES_CACHE_MAX_ENTRIES,
  THUMBNAIL_DEADLINE_MS,
  UPLOAD_QUOTA_MAX_ENTRIES,
  WHOLE_FILE_WINDOW,
} from "./consts";
import {
  clampRequestedRange,
  formatContentRange,
  formatUpstreamRange,
  parseRangeHeader,
} from "./logic/byte-range";
import { readCommittedFileMediaType } from "./logic/committed-media-type";
import { planMediaReply, planWholeReplyDeadline } from "./logic/media-reply";
import {
  isAttachmentMediaType,
  isVideoMediaType,
  readDeclaredMediaType,
} from "./logic/media-type";
import {
  findThumbnailRefusal,
  renderThumbnail,
} from "./logic/render-thumbnail";
import { createResizeTurns } from "./logic/resize-turns";
import { sliceStream } from "./logic/slice-stream";
import { sniffImageMediaType } from "./logic/sniff-image";
import { createStreamPermits } from "./logic/stream-permits";
import { reserveUpload } from "./logic/upload-quota";
import {
  throwMediaReplyRefusal,
  throwReadAttachmentFailure,
  throwThumbnailFailure,
  throwUploadAttachmentFailure,
} from "./logic/wire-failures";
import { listVideoAssets } from "./list-video-assets";
import { readAttachment } from "./read-attachment";
import { readCommittedFile } from "./read-committed-file";
import { committedFileQuerySchema, thumbnailQuerySchema } from "./schemas";
import {
  MediaReplyRefusalKinds,
  ReadAttachmentFailureKinds,
  ThumbnailFailureKinds,
  type AttachmentBytes,
  type AttachmentTarget,
  type AttachmentsRouteDeps,
  type BytesReadOptions,
  type CommittedFileStore,
  type CommittedLookupWindow,
  type MediaStreamBudget,
  type StreamPermit,
  type ReadAttachmentFailure,
  type RenderedSources,
  type RenderedSourcesStore,
  type StreamWindow,
  type UploadQuota,
  type UploadWindow,
  type WantedRange,
} from "./types";
import { uploadAttachment } from "./upload-attachment";

const HEAD_METHOD = "HEAD";

interface ImageBody {
  readonly bytes: Uint8Array;
  readonly mediaType: AttachmentMediaType;
}

interface MediaRequest {
  readonly wanted: WantedRange;
  readonly bytes: BytesReadOptions;
}

/** What a permitted stream carries and how long it may stream. */
interface PermittedSlice {
  readonly window: StreamWindow;
  readonly deadlineMs: number;
}

interface MediaReply {
  readonly request: MediaRequest;
  readonly budget: MediaStreamBudget;
}

interface ThumbnailRequest {
  readonly bytes: BytesReadOptions;
  readonly budget: MediaStreamBudget;
}

/** A bare id is a GitHub asset; `<id>.<ext>` is a file on the attachments branch. */
function parseAttachmentTarget(
  param: string | undefined,
): AttachmentTarget | undefined {
  if (param === undefined) {
    return undefined;
  }
  if (isAttachmentAssetId(param)) {
    return { kind: AttachmentSourceKinds.ASSET, assetId: param };
  }
  const file = parseAttachmentFileName(param);
  if (!file.ok) {
    return undefined;
  }
  return { kind: AttachmentSourceKinds.BRANCH, file: file.value };
}

function readTargetAssetId(target: AttachmentTarget): string {
  if (target.kind === AttachmentSourceKinds.ASSET) {
    return target.assetId;
  }
  return target.file.assetId;
}

/**
 * The bytes must be the type the request declares: the served type and the
 * file's extension both follow the declaration, so a mismatch is refused
 * rather than trusted either way.
 */
async function readImageBody(c: Context<AuthzEnv>): Promise<ImageBody> {
  const mediaType = readDeclaredMediaType(c.req.header("content-type"));
  if (mediaType === undefined) {
    throw new BadRequest(ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE);
  }
  const body = await readRawBodyWithinLimit(c.req.raw, ATTACHMENT_MAX_BYTES);
  if (!body.ok) {
    throw new PayloadTooLarge(ApiErrorCodes.REQUEST_TOO_LARGE);
  }
  if (sniffImageMediaType(body.value) !== mediaType) {
    throw new BadRequest(ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE);
  }
  return { bytes: body.value, mediaType };
}

function mintAttachmentFile(mediaType: AttachmentMediaType): AttachmentFile {
  const fileName = `${randomUUID()}.${ATTACHMENT_EXTENSION_BY_MEDIA_TYPE[mediaType]}`;
  const file = parseAttachmentFileName(fileName);
  if (!file.ok) {
    throw new Error("minted attachment file name failed its own parser");
  }
  return file.value;
}

/** The client's `Range`, closed to one piece, and how the reads ask upstream for it. */
function readMediaRequest(c: Context<AuthzEnv>): MediaRequest {
  const requested = parseRangeHeader(c.req.header("range"));
  const wanted = clampRequestedRange(requested, MEDIA_PIECE_BYTES);
  const bytes = {
    signal: c.req.raw.signal,
    upstreamRange: formatUpstreamRange(wanted, MEDIA_SNIFF_WINDOW_BYTES),
    rangeRequested: requested !== undefined,
  };
  return { wanted, bytes };
}

/** The fixed thumbnail form the query asks for, or undefined for the original. */
function readThumbnailOption(
  c: Context<AuthzEnv>,
): AttachmentThumbnail | undefined {
  const query = thumbnailQuerySchema.safeParse({
    [ATTACHMENT_THUMBNAIL_PARAM]: c.req.query(ATTACHMENT_THUMBNAIL_PARAM),
  });
  if (!query.success) {
    throw new BadRequest();
  }
  return query.data[ATTACHMENT_THUMBNAIL_PARAM];
}

/**
 * A thumbnail reads its original whole, without `Range`, so it never takes a
 * stream permit; one deadline covers the upstream request and the whole body.
 */
function buildThumbnailReadOptions(
  c: Context<AuthzEnv>,
  media: BytesReadOptions,
): BytesReadOptions {
  const deadline = AbortSignal.timeout(THUMBNAIL_DEADLINE_MS);
  const signal = AbortSignal.any([c.req.raw.signal, deadline]);
  return { ...media, signal, rangeRequested: false };
}

/** The read options a request's bytes are fetched with: the thumbnail's own when one was asked, else the client's. */
function buildBytesReadOptions(
  c: Context<AuthzEnv>,
  media: BytesReadOptions,
  thumbnail: AttachmentThumbnail | undefined,
): BytesReadOptions {
  return thumbnail === undefined ? media : buildThumbnailReadOptions(c, media);
}

/** HEAD names the reply a GET would carry without the resize: the type and size checks, no decode. */
async function answerThumbnailHead(
  c: Context<AuthzEnv>,
  original: AttachmentBytes,
  budget: MediaStreamBudget,
): Promise<Response> {
  const refusal = findThumbnailRefusal(budget, original);
  await original.body.cancel();
  if (refusal !== undefined) {
    throwThumbnailFailure({ kind: refusal });
  }
  return c.body(null, HttpStatuses.OK, {
    ...ATTACHMENT_RESPONSE_HEADERS,
    "content-type": AttachmentMediaTypes.WEBP,
  });
}

/** The original's strip thumbnail as WebP, under the same sandboxed no-store headers. */
async function answerThumbnail(
  c: Context<AuthzEnv>,
  original: AttachmentBytes,
  thumbnail: ThumbnailRequest,
): Promise<Response> {
  if (c.req.method === HEAD_METHOD) {
    return answerThumbnailHead(c, original, thumbnail.budget);
  }
  const rendered = await renderThumbnail(
    thumbnail.budget,
    original,
    thumbnail.bytes.signal,
  );
  if (!rendered.ok) {
    const log = c.get("logger");
    if (rendered.error.kind === ThumbnailFailureKinds.BUSY) {
      log.warn("thumbnail resizes at their limit", {
        running: thumbnail.budget.resizeTurns.countRunning(),
        waiting: thumbnail.budget.resizeTurns.countWaiting(),
      });
    } else {
      log.debug("thumbnail not made", { failure: rendered.error });
    }
    throwThumbnailFailure(rendered.error);
  }

  return c.body(rendered.value, HttpStatuses.OK, {
    ...ATTACHMENT_RESPONSE_HEADERS,
    "content-length": String(rendered.value.byteLength),
    "content-type": AttachmentMediaTypes.WEBP,
  });
}

/** No body; the file's size when known, as a 416 should carry it. */
function answerRangeNotSatisfiable(
  c: Context<AuthzEnv>,
  total?: number,
): Response {
  const headers: Record<string, string> = { ...ATTACHMENT_RESPONSE_HEADERS };
  if (total !== undefined) {
    headers["content-range"] = `bytes */${total}`;
  }
  return c.body(null, HttpStatuses.RANGE_NOT_SATISFIABLE, headers);
}

/** One piece of a file as a 206, at most `MEDIA_PIECE_BYTES`. */
async function answerMediaPiece(
  c: Context<AuthzEnv>,
  bytes: AttachmentBytes,
  wanted: WantedRange,
  budget: MediaStreamBudget,
): Promise<Response> {
  const plan = planMediaReply(bytes.extent, wanted, budget.maxFileBytes);
  if (!plan.ok) {
    await bytes.body.cancel();
    if (plan.error.kind === MediaReplyRefusalKinds.UNSATISFIABLE) {
      return answerRangeNotSatisfiable(c, plan.error.total);
    }
    throwMediaReplyRefusal(plan.error);
  }

  const headers = {
    ...ATTACHMENT_RESPONSE_HEADERS,
    "accept-ranges": ACCEPT_RANGES_BYTES,
    "content-length": String(plan.value.length),
    "content-range": formatContentRange(plan.value),
    "content-type": bytes.contentType,
  };
  if (c.req.method === HEAD_METHOD) {
    await bytes.body.cancel();
    return c.body(null, HttpStatuses.PARTIAL_CONTENT, headers);
  }
  const body = await openPermittedStream(c, bytes, budget, {
    window: plan.value,
    deadlineMs: MEDIA_PIECE_DEADLINE_MS,
  });
  return c.body(body, HttpStatuses.PARTIAL_CONTENT, headers);
}

function acquireStreamPermit(
  c: Context<AuthzEnv>,
  budget: MediaStreamBudget,
): StreamPermit | undefined {
  const permit = budget.permits.acquire();
  if (permit === undefined) {
    c.get("logger").warn("media streams at their limit", {
      open: budget.permits.countOpen(),
    });
  }
  return permit;
}

/**
 * The body holds one of the process's stream permits from its first byte
 * until it ends, errors, the client leaves or its deadline passes, and
 * releases it exactly once. With none free, upstream is cancelled and the
 * read answers 503.
 */
async function openPermittedStream(
  c: Context<AuthzEnv>,
  bytes: AttachmentBytes,
  budget: MediaStreamBudget,
  slice: PermittedSlice,
): Promise<ReadableStream<Uint8Array>> {
  const permit = acquireStreamPermit(c, budget);
  if (permit === undefined) {
    await bytes.body.cancel();
    throw new ServiceUnavailable(ApiErrorCodes.MEDIA_STREAMS_BUSY);
  }
  return sliceStream(bytes.body, slice.window, {
    signal: c.req.raw.signal,
    onSettled: () => {
      permit.release();
    },
    deadlineMs: slice.deadlineMs,
  });
}

/**
 * An image as a whole 200. It holds an upstream socket as a piece does, so
 * it takes a permit the same way, after the cap check; an img cannot ask for
 * the rest, so its deadline is sized for the whole file.
 */
async function answerWholeFile(
  c: Context<AuthzEnv>,
  bytes: AttachmentBytes,
  budget: MediaStreamBudget,
): Promise<Response> {
  const deadline = planWholeReplyDeadline(bytes.extent, budget.maxFileBytes);
  if (!deadline.ok) {
    await bytes.body.cancel();
    throwMediaReplyRefusal(deadline.error);
  }

  const headers = {
    ...ATTACHMENT_RESPONSE_HEADERS,
    "content-type": bytes.contentType,
  };
  // Hono answers HEAD by running the handler and dropping the body; the
  // upstream stream would otherwise stay open until it timed out.
  if (c.req.method === HEAD_METHOD) {
    await bytes.body.cancel();
    return c.body(null, HttpStatuses.OK, headers);
  }
  const body = await openPermittedStream(c, bytes, budget, {
    window: WHOLE_FILE_WINDOW,
    deadlineMs: deadline.value,
  });
  return c.body(body, HttpStatuses.OK, headers);
}

/**
 * A video always answers in pieces. An image answers a piece only when the
 * client asked a `Range` and upstream named its extent; otherwise the range
 * is ignored, as a server may, and the image keeps its whole 200.
 */
async function answerAttachmentBytes(
  c: Context<AuthzEnv>,
  bytes: AttachmentBytes,
  media: MediaReply,
): Promise<Response> {
  const servesImagePiece =
    media.request.bytes.rangeRequested && bytes.extent !== undefined;
  const answersPiece = servesImagePiece || isVideoMediaType(bytes.contentType);
  if (answersPiece) {
    return answerMediaPiece(c, bytes, media.request.wanted, media.budget);
  }

  return answerWholeFile(c, bytes, media.budget);
}

/** Upstream refusing the range is a 416; every other failure throws its wire error. */
function answerReadFailure(
  c: Context<AuthzEnv>,
  failure: ReadAttachmentFailure,
): Response {
  if (failure.kind === ReadAttachmentFailureKinds.RANGE_NOT_SATISFIABLE) {
    return answerRangeNotSatisfiable(c);
  }
  throwReadAttachmentFailure(failure);
}

function createReadAttachmentHandler(
  deps: AttachmentsRouteDeps,
  sources: RenderedSourcesStore,
  budget: MediaStreamBudget,
): Handler<AuthzEnv> {
  return async (c) => {
    const prNumber = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!prNumber.success) {
      throw new BadRequest();
    }
    // A malformed id is a 404, not a 400: the shape is not a hint to give.
    const target = parseAttachmentTarget(c.req.param("assetId"));
    if (target === undefined) {
      throw new NotFound();
    }

    const thumbnail = readThumbnailOption(c);

    const log = c.get("logger");
    const repoAccess = c.get("repoAccess");
    const github = bindGrantedPullRequestGitHub(deps, repoAccess, log);
    const request = readMediaRequest(c);
    const bytes = buildBytesReadOptions(c, request.bytes, thumbnail);
    const read = await readAttachment(
      { sources, fetch: globalThis.fetch },
      { ...repoAccess, github },
      { prNumber: prNumber.data, target, bytes },
    );
    if (!read.ok) {
      return answerReadFailure(c, read.error);
    }

    log.debug("attachment proxied", { assetId: readTargetAssetId(target) });
    if (thumbnail !== undefined) {
      return answerThumbnail(c, read.value, { bytes, budget });
    }
    return answerAttachmentBytes(c, read.value, { request, budget });
  };
}

/** The address must name the gated repository; anything else is the same 404 a missing file is. */
function parseRepositorySource(
  rawSource: string | undefined,
  repoFullName: string,
): CommittedFileSource | undefined {
  const query = committedFileQuerySchema.safeParse({ source: rawSource });
  if (!query.success) {
    return undefined;
  }
  const source = parseCommittedFileUrl(query.data.source);
  if (!source.ok || !isCommittedFileInRepository(source.value, repoFullName)) {
    return undefined;
  }
  return source.value;
}

/** An SVG or a video is never thumbnailed, so its thumbnail is refused before any GitHub call. */
function isRasterFileName(source: CommittedFileSource): boolean {
  const declared = readCommittedFileMediaType(source.pathSegments);
  return declared !== undefined && isAttachmentMediaType(declared);
}

function createReadCommittedFileHandler(
  store: CommittedFileStore,
  budget: MediaStreamBudget,
): Handler<AuthzEnv> {
  return async (c) => {
    const repoAccess = c.get("repoAccess");
    const source = parseRepositorySource(
      c.req.query("source"),
      repoAccess.repoFullName,
    );
    if (source === undefined) {
      throw new NotFound();
    }
    const thumbnail = readThumbnailOption(c);
    if (thumbnail !== undefined && !isRasterFileName(source)) {
      throw new NotFound();
    }

    const request = readMediaRequest(c);
    const bytes = buildBytesReadOptions(c, request.bytes, thumbnail);
    const read = await readCommittedFile(
      { store, fetch: globalThis.fetch },
      repoAccess,
      { pathSegments: source.pathSegments, bytes },
    );
    if (!read.ok) {
      return answerReadFailure(c, read.error);
    }
    if (thumbnail !== undefined) {
      return answerThumbnail(c, read.value, { bytes, budget });
    }
    return answerAttachmentBytes(c, read.value, { request, budget });
  };
}

/** Not human-only: the CLI attaches with its Bearer token, and the commit is the App's. */
function createUploadAttachmentHandler(
  deps: AttachmentsRouteDeps,
  quota: UploadQuota,
): Handler<AuthzEnv> {
  return async (c) => {
    const { bytes, mediaType } = await readImageBody(c);

    // Reserved before the first GitHub call, on bytes the cap already
    // passed: a refusal costs no call, and a rejected file is never charged.
    const access = c.get("repoAccess");
    const reviewerId = String(access.session.reviewerId);
    const reserved = reserveUpload(
      quota,
      reviewerId,
      bytes.byteLength,
      Date.now(),
    );
    if (!reserved.ok) {
      c.header(RETRY_AFTER_HEADER, String(reserved.error.retryAfterSeconds));
      throw new TooManyRequests(ApiErrorCodes.ATTACHMENT_LIMIT_REACHED);
    }

    const file = mintAttachmentFile(mediaType);
    const uploaded = await uploadAttachment(deps, access, { file, bytes });
    if (!uploaded.ok) {
      throwUploadAttachmentFailure(uploaded.error, access.footing);
    }

    c.get("logger").debug("attachment uploaded", { assetId: file.assetId });
    const body: UploadAttachmentResponse = uploaded.value;
    return c.json(body, HttpStatuses.CREATED, NO_STORE);
  };
}

function createListVideoAssetsHandler(
  deps: AttachmentsRouteDeps,
  sources: RenderedSourcesStore,
): Handler<AuthzEnv> {
  return async (c) => {
    const prNumber = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!prNumber.success) {
      throw new BadRequest();
    }

    const repoAccess = c.get("repoAccess");
    const github = bindGrantedPullRequestGitHub(
      deps,
      repoAccess,
      c.get("logger"),
    );
    const missing = c.req.query(VIDEO_ASSETS_MISSING_PARAM) ?? "";
    const missingAssetId = isAttachmentAssetId(missing) ? missing : undefined;
    const listed = await listVideoAssets(
      { sources },
      { ...repoAccess, github },
      { prNumber: prNumber.data, missingAssetId },
    );
    if (!listed.ok) {
      throwReadAttachmentFailure(listed.error);
    }

    const body: VideoAssetsResponse = { assetIds: listed.value };
    return c.json(body, HttpStatuses.OK, NO_STORE);
  };
}

/** One per process: the attachment read and the video list share one GitHub call per viewer and PR. */
export function createRenderedSourcesStore(): RenderedSourcesStore {
  return {
    cache: createTtlCache<RenderedSources>(SOURCES_CACHE_MAX_ENTRIES),
    inFlight: new Map(),
  };
}

/** One per process: both reads count their open streams and running resizes against the same limits. */
export function createMediaStreamBudget(
  maxFileBytes = DEFAULT_MEDIA_MAX_MB * BYTES_PER_MB,
): MediaStreamBudget {
  return {
    maxFileBytes,
    permits: createStreamPermits(MAX_OPEN_MEDIA_STREAMS),
    resizeTurns: createResizeTurns(
      MAX_RUNNING_RESIZES,
      RESIZE_TURN_WAIT_MS,
      MAX_WAITING_RESIZES,
    ),
  };
}

export function attachmentsRoute(
  deps: AttachmentsRouteDeps,
  budget: MediaStreamBudget,
  sources: RenderedSourcesStore,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const quota: UploadQuota = {
    limits: deps.attachmentQuota ?? DEFAULT_UPLOAD_QUOTA_LIMITS,
    windows: createTtlCache<UploadWindow>(UPLOAD_QUOTA_MAX_ENTRIES),
  };
  // Only the upload is audited; the read carries the stamp unread.
  app.use(createRepositoryTargetLayer());
  app.query(
    {
      id: ProductQueryIds.READ_ATTACHMENT,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: false,
    },
    "/:assetId",
    createReadAttachmentHandler(deps, sources, budget),
  );
  // Installation-only: the branch is written with the installation token.
  app.action(
    {
      id: ProductActionIds.UPLOAD_ATTACHMENT,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: true,
      requiresStoredPullRequest: false,
    },
    "/",
    createUploadAttachmentHandler(deps, quota),
  );
  return app;
}

/** GET .../video-assets: the pasted assets GitHub rendered as a video. */
export function videoAssetsRoute(
  deps: AttachmentsRouteDeps,
  sources: RenderedSourcesStore,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  app.use(createRepositoryTargetLayer());
  app.query(
    {
      id: ProductQueryIds.LIST_VIDEO_ASSETS,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: false,
    },
    "/",
    createListVideoAssetsHandler(deps, sources),
  );
  return app;
}

/** GET .../committed-file?source=: an image or video committed to the pull request's own repository. */
export function committedFileRoute(
  deps: Pick<AttachmentsRouteDeps, "committedLookupBudget">,
  budget: MediaStreamBudget,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const store: CommittedFileStore = {
    refs: {
      cache: createTtlCache<readonly string[]>(
        COMMITTED_FILE_CACHE_MAX_ENTRIES,
      ),
      inFlight: new Map(),
    },
    downloadUrls: createTtlCache<string>(COMMITTED_FILE_CACHE_MAX_ENTRIES),
    lookupBudget: {
      limits: deps.committedLookupBudget ?? DEFAULT_COMMITTED_LOOKUP_LIMITS,
      windows: createTtlCache<CommittedLookupWindow>(
        COMMITTED_LOOKUP_BUDGET_MAX_ENTRIES,
      ),
    },
  };
  app.use(createRepositoryTargetLayer());
  app.query(
    {
      id: ProductQueryIds.READ_COMMITTED_FILE,
      browserSessionOnly: false,
      requiresOperator: false,
      requiresPushAccess: false,
      requiresInstallation: false,
      requiresStoredPullRequest: false,
    },
    "/",
    createReadCommittedFileHandler(store, budget),
  );
  return app;
}
