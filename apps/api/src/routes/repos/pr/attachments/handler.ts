import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import {
  ApiErrorCodes,
  ATTACHMENT_EXTENSION_BY_MEDIA_TYPE,
  ATTACHMENT_MAX_BYTES,
  AttachmentSourceKinds,
  isAttachmentAssetId,
  parseAttachmentFileName,
  type AttachmentFile,
  type AttachmentMediaType,
} from "contract";
import {
  BadRequest,
  NotFound,
  PayloadTooLarge,
  TooManyRequests,
} from "../../../../shared-errors/api-error";
import { stampAuditTarget } from "../../../../product-operations/audit";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import {
  readFallbackTokenFor,
  requireInstallationScope,
  type AuthzEnv,
} from "../../../authz";
import { readRawBodyWithinLimit } from "../../../read-body";
import type { TtlCache } from "../../../ttl-cache";
import { HttpStatuses, type Result } from "types";
import { prNumberSchema } from "../../../wire-bounds";
import { parseOwnerAndName } from "../../utils";
import { attachmentsController } from "./controller";
import {
  ATTACHMENT_RESPONSE_HEADERS,
  NO_STORE,
  RETRY_AFTER_HEADER,
} from "./consts";
import { readDeclaredMediaType } from "./logic/media-type";
import { sniffImageMediaType } from "./logic/sniff-image";
import { reserveUpload } from "./logic/upload-quota";
import {
  throwReadAttachmentFailure,
  throwUploadAttachmentFailure,
} from "./logic/wire-failures";
import type {
  AttachmentBytes,
  AttachmentTarget,
  AttachmentsControllerDeps,
  AttachmentsHandlers,
  AttachmentsRouteDeps,
  ReadAttachmentFailure,
  ReadAttachmentInput,
  RenderedSources,
  UploadQuota,
} from "./types";

const HEAD_METHOD = "HEAD";

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

function readTarget(
  deps: AttachmentsControllerDeps,
  target: AttachmentTarget,
  scope: Omit<ReadAttachmentInput, "assetId">,
): Promise<Result<AttachmentBytes, ReadAttachmentFailure>> {
  if (target.kind === AttachmentSourceKinds.BRANCH) {
    return attachmentsController.readBranchAttachment(deps, {
      owner: scope.owner,
      repo: scope.repo,
      file: target.file,
    });
  }
  return attachmentsController.readAttachment(deps, {
    ...scope,
    assetId: target.assetId,
  });
}

/**
 * The bytes must be the type the request declares: the served type and the
 * file's extension both follow the declaration, so a mismatch is refused
 * rather than trusted either way.
 */
async function readImageBody(
  c: Context<AuthzEnv>,
): Promise<{ bytes: Uint8Array; mediaType: AttachmentMediaType }> {
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

export function createAttachmentsHandlers(
  deps: AttachmentsRouteDeps,
  sourcesCache: TtlCache<RenderedSources>,
  sourcesInFlight: AttachmentsControllerDeps["sourcesInFlight"],
  uploadQuota: UploadQuota,
): AttachmentsHandlers {
  const readAttachment = async (c: Context<AuthzEnv>) => {
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!parsedPr.success) {
      throw new BadRequest();
    }
    // A malformed id is a 404, not a 400: the shape is not a hint to give.
    const target = parseAttachmentTarget(c.req.param("assetId"));
    if (target === undefined) {
      throw new NotFound();
    }
    // The authz-verified full name, as the diff proxy reads it.
    const repo = parseOwnerAndName(c.get("repoFullName"));
    if (repo === undefined) {
      throw new NotFound();
    }

    const session = c.get("session");
    const github = createReviewerGitHubClient(
      deps,
      session,
      c.get("logger"),
      readFallbackTokenFor(c, deps),
    );
    const fetched = await readTarget(
      {
        github,
        fetchImpl: globalThis.fetch,
        sourcesCache,
        sourcesInFlight,
        repoId: String(c.get("repoId")),
      },
      target,
      {
        owner: repo.owner,
        repo: repo.repo,
        prNumber: parsedPr.data,
        sessionTokenHash: session.sessionTokenHash,
      },
    );
    if (!fetched.ok) {
      throwReadAttachmentFailure(fetched.error);
    }

    const headers = {
      ...ATTACHMENT_RESPONSE_HEADERS,
      "content-type": fetched.value.contentType,
    };
    // Hono answers HEAD by running this handler and dropping the body; the
    // upstream stream would otherwise stay open until it timed out.
    if (c.req.method === HEAD_METHOD) {
      await fetched.value.body.cancel();
      return c.body(null, HttpStatuses.OK, headers);
    }

    c.get("logger").debug("attachment proxied", {
      assetId:
        target.kind === AttachmentSourceKinds.ASSET
          ? target.assetId
          : target.file.assetId,
    });
    return c.body(fetched.value.body, HttpStatuses.OK, headers);
  };

  // No assertHuman: the CLI attaches through this route with its Bearer
  // token, and the commit is the App's, not the viewer's signature.
  const uploadAttachment = async (c: Context<AuthzEnv>) => {
    const parsedPr = prNumberSchema.safeParse(c.req.param("prNumber"));
    if (!parsedPr.success) {
      throw new BadRequest();
    }
    // Stamped first, so a refusal past the gate names the repository too.
    stampAuditTarget(c, "repository", c.get("repoId"));
    // App-only: the branch is written with the installation token, so the
    // owner world (a url-box brief) has nothing to write with.
    const installationId = requireInstallationScope(c.get("ctx"));
    const { bytes, mediaType } = await readImageBody(c);

    // Reserved before the first GitHub call, on bytes the cap already
    // passed: a refusal costs no call, and a rejected file is never charged.
    const session = c.get("session");
    const reserved = reserveUpload(
      uploadQuota,
      String(session.reviewerId),
      bytes.byteLength,
      Date.now(),
    );
    if (!reserved.ok) {
      c.header(RETRY_AFTER_HEADER, String(reserved.error.retryAfterSeconds));
      throw new TooManyRequests(ApiErrorCodes.ATTACHMENT_LIMIT_REACHED);
    }

    const reviewer = createReviewerGitHubClient(deps, session, c.get("logger"));
    const file = mintAttachmentFile(mediaType);
    const uploaded = await attachmentsController.uploadAttachment(
      { reviewer, port: deps.github },
      {
        installationId,
        repoId: c.get("repoId"),
        file,
        mediaType,
        bytes,
      },
    );
    if (!uploaded.ok) {
      throwUploadAttachmentFailure(
        uploaded.error,
        c.get("urlBoxOnly") === true,
      );
    }

    c.get("logger").debug("attachment uploaded", { assetId: file.assetId });
    return c.json(uploaded.value, HttpStatuses.CREATED, NO_STORE);
  };

  return { readAttachment, uploadAttachment };
}
