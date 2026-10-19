// GET .../attachments/:assetId and POST .../attachments, behind the pr
// subtree's shared gate. A pasted screenshot in a GitHub comment is private
// to the repo, and the browser cannot carry a GitHub login across origins,
// so the API streams the bytes same-origin, where the session cookie rides
// an <img> request: a bare id is a GitHub asset, found through the URL
// GitHub rendered for it; `<id>.<ext>` is a file on the repo's attachments
// branch, read from the Contents API. The upload commits an image to that
// branch with the App's token and answers the URL a comment carries.
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
import type {
  AttachmentTarget,
  AttachmentsRouteDeps,
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

    const headers = {
      ...ATTACHMENT_RESPONSE_HEADERS,
      "content-type": read.value.contentType,
    };
    // Hono answers HEAD by running this handler and dropping the body; the
    // upstream stream would otherwise stay open until it timed out.
    if (c.req.method === HEAD_METHOD) {
      await read.value.body.cancel();
      return c.body(null, HttpStatuses.OK, headers);
    }

    log.debug("attachment proxied", { assetId: readTargetAssetId(target) });
    return c.body(read.value.body, HttpStatuses.OK, headers);
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
