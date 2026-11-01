import type { Result } from "types";
import {
  ASSET_ID_PATTERN,
  ATTACHMENT_ASSET_ORIGIN,
  ATTACHMENT_ASSET_PATH_PREFIX,
  ATTACHMENT_BRANCH,
  ATTACHMENT_BRANCH_RAW_QUERY,
  ATTACHMENT_EXTENSION_BY_MEDIA_TYPE,
} from "./consts";
import {
  AttachmentMediaTypes,
  AttachmentParseErrorCodes,
  AttachmentSourceKinds,
  type AttachmentAssetId,
  type AttachmentBranchLocation,
  type AttachmentFile,
  type AttachmentMediaType,
  type AttachmentParseErrorCode,
  type AttachmentSource,
} from "./types";

export {
  ATTACHMENT_ASSET_ORIGIN,
  ATTACHMENT_ASSET_PATH_PREFIX,
  ATTACHMENT_BRANCH,
  ATTACHMENT_EXTENSION_BY_MEDIA_TYPE,
  ATTACHMENT_MAX_BYTES,
} from "./consts";
export {
  AttachmentMediaTypes,
  AttachmentParseErrorCodes,
  AttachmentSourceKinds,
  type AssetAttachmentSource,
  type AttachmentAssetId,
  type AttachmentBranchLocation,
  type AttachmentFile,
  type AttachmentMediaType,
  type AttachmentParseErrorCode,
  type AttachmentSource,
  type AttachmentSourceKind,
  type BranchAttachmentSource,
  type UploadAttachmentResponse,
} from "./types";

type ParseResult<T> = Result<T, AttachmentParseErrorCode>;

const NOT_AN_ATTACHMENT: ParseResult<never> = {
  ok: false,
  error: AttachmentParseErrorCodes.NOT_AN_ATTACHMENT,
};

const MEDIA_TYPE_BY_EXTENSION: ReadonlyMap<string, AttachmentMediaType> =
  new Map(
    Object.values(AttachmentMediaTypes).map((mediaType) => [
      ATTACHMENT_EXTENSION_BY_MEDIA_TYPE[mediaType],
      mediaType,
    ]),
  );

const OWNER_SEGMENT = "[A-Za-z0-9_-]+";
const REPO_SEGMENT = "[A-Za-z0-9._-]+";
const BRANCH_BLOB_PATH = new RegExp(
  `^/(${OWNER_SEGMENT})/(${REPO_SEGMENT})/blob/${ATTACHMENT_BRANCH}/([^/]+)$`,
);
/** The address GitHub pasted before `user-attachments`, scoped to a repository. */
const REPOSITORY_ASSET_PATH = new RegExp(
  `^/${OWNER_SEGMENT}/${REPO_SEGMENT}/assets/\\d+/([^/]+)$`,
);

export function isAttachmentAssetId(value: string): value is AttachmentAssetId {
  return ASSET_ID_PATTERN.test(value);
}

/** `<assetId>.<ext>` with an allowlisted extension; anything else is refused. */
export function parseAttachmentFileName(
  fileName: string,
): ParseResult<AttachmentFile> {
  const dot = fileName.lastIndexOf(".");
  if (dot === -1) {
    return NOT_AN_ATTACHMENT;
  }
  const stem = fileName.slice(0, dot);
  const mediaType = MEDIA_TYPE_BY_EXTENSION.get(fileName.slice(dot + 1));
  if (mediaType === undefined || !isAttachmentAssetId(stem)) {
    return NOT_AN_ATTACHMENT;
  }
  return { ok: true, value: { assetId: stem, fileName, mediaType } };
}

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function hasBareAuthority(url: URL): boolean {
  return (
    url.origin === ATTACHMENT_ASSET_ORIGIN &&
    url.username === "" &&
    url.password === "" &&
    url.hash === ""
  );
}

/** The id an asset path names, in GitHub's `user-attachments` form or its older per-repository one; any other path names none. */
export function readAssetPathId(pathname: string): string | undefined {
  if (pathname.startsWith(ATTACHMENT_ASSET_PATH_PREFIX)) {
    return pathname.slice(ATTACHMENT_ASSET_PATH_PREFIX.length);
  }
  const [, id] = REPOSITORY_ASSET_PATH.exec(pathname) ?? [];
  return id;
}

function parseAssetPath(id: string, url: URL): ParseResult<AttachmentSource> {
  if (url.search !== "" || !isAttachmentAssetId(id)) {
    return NOT_AN_ATTACHMENT;
  }
  return {
    ok: true,
    value: { kind: AttachmentSourceKinds.ASSET, assetId: id },
  };
}

function parseBranchPath(url: URL): ParseResult<AttachmentSource> {
  if (url.search !== ATTACHMENT_BRANCH_RAW_QUERY) {
    return NOT_AN_ATTACHMENT;
  }
  const match = BRANCH_BLOB_PATH.exec(url.pathname);
  const [, owner, repo, fileName] = match ?? [];
  if (owner === undefined || repo === undefined || fileName === undefined) {
    return NOT_AN_ATTACHMENT;
  }
  const file = parseAttachmentFileName(fileName);
  if (!file.ok) {
    return file;
  }
  return {
    ok: true,
    value: {
      kind: AttachmentSourceKinds.BRANCH,
      owner,
      repo,
      ...file.value,
    },
  };
}

/**
 * The shapes an attachment is written as: GitHub's own asset URL, its older
 * per-repository asset URL, and a file on the repository's attachments
 * branch linked with `?raw=true`.
 */
export function parseAttachmentSource(
  url: string,
): ParseResult<AttachmentSource> {
  const parsed = parseUrl(url);
  if (parsed === undefined || !hasBareAuthority(parsed)) {
    return NOT_AN_ATTACHMENT;
  }
  const assetId = readAssetPathId(parsed.pathname);
  if (assetId !== undefined) {
    return parseAssetPath(assetId, parsed);
  }
  return parseBranchPath(parsed);
}

/** The asset id of either shape. */
export function parseAttachmentAssetId(
  url: string,
): ParseResult<AttachmentAssetId> {
  const source = parseAttachmentSource(url);
  if (!source.ok) {
    return source;
  }
  return { ok: true, value: source.value.assetId };
}

/** The URL the upload answers and a comment carries; GitHub renders it inline. */
export function buildAttachmentBranchUrl(
  location: AttachmentBranchLocation,
): string {
  const { owner, repo, fileName } = location;
  return `${ATTACHMENT_ASSET_ORIGIN}/${owner}/${repo}/blob/${ATTACHMENT_BRANCH}/${fileName}${ATTACHMENT_BRANCH_RAW_QUERY}`;
}
