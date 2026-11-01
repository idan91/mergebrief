// A pasted screenshot or a committed image is private to the repo, and the
// browser cannot carry a GitHub login across origins, so the API streams the
// bytes same-origin, where the session cookie rides an <img> request: a bare
// id is a GitHub asset, found through the URL GitHub rendered for it;
// `<id>.<ext>` is a file on the attachments branch; `committed-file?source=`
// names any other file in the repo by its normalised address. The upload
// commits an image to the attachments branch with the App's token.
import { randomUUID } from "node:crypto";
import {
  ApiErrorCodes,
  ATTACHMENT_EXTENSION_BY_MEDIA_TYPE,
  ATTACHMENT_MAX_BYTES,
  AttachmentSourceKinds,
  isAttachmentAssetId,
  parseAttachmentFileName,
  ProductActionIds,
  ProductQueryIds,
  type AttachmentFile,
  type AttachmentMediaType,
  type UploadAttachmentResponse,
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
  TooManyRequests,
} from "../../../../shared-errors/api-error";
import { readRawBodyWithinLimit } from "../../../read-body";
import { createTtlCache } from "../../../ttl-cache";
import { prNumberSchema } from "../../../wire-bounds";
import { createRepositoryTargetLayer } from "../../logic/repository-target";
import {
  ATTACHMENT_RESPONSE_HEADERS,
  COMMITTED_FILE_CACHE_MAX_ENTRIES,
  COMMITTED_LOOKUP_BUDGET_MAX_ENTRIES,
  DEFAULT_COMMITTED_LOOKUP_LIMITS,
  DEFAULT_UPLOAD_QUOTA_LIMITS,
  NO_STORE,
  RETRY_AFTER_HEADER,
  SOURCES_CACHE_MAX_ENTRIES,
  UPLOAD_QUOTA_MAX_ENTRIES,
} from "./consts";
import { readDeclaredMediaType } from "./logic/media-type";
import { sniffImageMediaType } from "./logic/sniff-image";
import { reserveUpload } from "./logic/upload-quota";
import {
  throwReadAttachmentFailure,
  throwUploadAttachmentFailure,
} from "./logic/wire-failures";
import { readAttachment } from "./read-attachment";
import { readCommittedFile } from "./read-committed-file";
import { committedFileQuerySchema } from "./schemas";
import type {
  AttachmentBytes,
  AttachmentTarget,
  AttachmentsRouteDeps,
  CommittedFileStore,
  CommittedLookupWindow,
  RenderedSources,
  RenderedSourcesStore,
  UploadQuota,
  UploadWindow,
} from "./types";
import { uploadAttachment } from "./upload-attachment";

const HEAD_METHOD = "HEAD";

interface ImageBody {
  readonly bytes: Uint8Array;
  readonly mediaType: AttachmentMediaType;
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

async function answerAttachmentBytes(
  c: Context<AuthzEnv>,
  bytes: AttachmentBytes,
): Promise<Response> {
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
  return c.body(bytes.body, HttpStatuses.OK, headers);
}

function createReadAttachmentHandler(
  deps: AttachmentsRouteDeps,
  sources: RenderedSourcesStore,
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

    const log = c.get("logger");
    const repoAccess = c.get("repoAccess");
    const github = bindGrantedPullRequestGitHub(deps, repoAccess, log);
    const read = await readAttachment(
      { sources, fetch: globalThis.fetch },
      { ...repoAccess, github },
      { prNumber: prNumber.data, target },
    );
    if (!read.ok) {
      throwReadAttachmentFailure(read.error);
    }

    log.debug("attachment proxied", { assetId: readTargetAssetId(target) });
    return answerAttachmentBytes(c, read.value);
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

function createReadCommittedFileHandler(
  store: CommittedFileStore,
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

    const read = await readCommittedFile(
      { store, fetch: globalThis.fetch },
      repoAccess,
      { pathSegments: source.pathSegments },
    );
    if (!read.ok) {
      throwReadAttachmentFailure(read.error);
    }
    return answerAttachmentBytes(c, read.value);
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

export function attachmentsRoute(
  deps: AttachmentsRouteDeps,
): ProductRouter<AuthzEnv> {
  const app = productRouter<AuthzEnv>();
  const sources: RenderedSourcesStore = {
    cache: createTtlCache<RenderedSources>(SOURCES_CACHE_MAX_ENTRIES),
    inFlight: new Map(),
  };
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
    createReadAttachmentHandler(deps, sources),
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

/** GET .../committed-file?source=: an image committed to the pull request's own repository. */
export function committedFileRoute(
  deps: Pick<AttachmentsRouteDeps, "committedLookupBudget">,
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
    createReadCommittedFileHandler(store),
  );
  return app;
}
