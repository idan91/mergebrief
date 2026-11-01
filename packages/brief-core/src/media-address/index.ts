// The three raw addresses of a file committed to a GitHub repository, read
// into one shape and written back as one address. Runs in the browser and
// the api: it imports nothing at runtime beyond the types package.
import type { Result } from "types/utils";
import {
  BLOB_PATH_MODE,
  BLOB_RAW_QUERY,
  COMMITTED_FILE_PATH_MAX_LENGTH,
  GITHUB_HOST,
  GITHUB_ORIGIN,
  MIN_PATH_SEGMENTS,
  QUALIFIED_REF_ROOT,
  RAW_CONTENT_HOST,
  RAW_PATH_MODE,
} from "./consts";
import {
  CommittedFileParseErrorCodes,
  CommittedMediaExtensions,
  QualifiedRefNamespaces,
  type CommittedFileParseErrorCode,
  type CommittedMediaExtension,
  type CommittedFileSource,
  type QualifiedRef,
  type QualifiedRefNamespace,
} from "./types";

export {
  CommittedFileParseErrorCodes,
  CommittedMediaExtensions,
  QualifiedRefNamespaces,
  type CommittedFileSource,
  type CommittedMediaExtension,
  type QualifiedRef,
  type QualifiedRefNamespace,
} from "./types";

type ParseResult = Result<CommittedFileSource, CommittedFileParseErrorCode>;

interface AddressParts {
  readonly owner: string;
  readonly repo: string;
  readonly encodedSegments: readonly string[];
}

const NOT_A_COMMITTED_FILE: ParseResult = {
  ok: false,
  error: CommittedFileParseErrorCodes.NOT_A_COMMITTED_FILE,
};
const UNSAFE_PATH: ParseResult = {
  ok: false,
  error: CommittedFileParseErrorCodes.UNSAFE_PATH,
};

const OWNER_PATTERN = /^[A-Za-z0-9_-]+$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
/**
 * Decoded once, a segment holding a slash or backslash was an encoded one,
 * and a `%` was a second layer of encoding; controls and invisible
 * characters name a file no reader can see.
 */
const UNSAFE_SEGMENT_CHARS =
  /[\p{Cc}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Bidi_Control}%/\\]/u;
const DOT_SEGMENTS: ReadonlySet<string> = new Set([".", ".."]);

const QUALIFIED_REF_NAMESPACES: ReadonlySet<string> = new Set(
  Object.values(QualifiedRefNamespaces),
);
const COMMITTED_MEDIA_EXTENSIONS: ReadonlySet<string> = new Set(
  Object.values(CommittedMediaExtensions),
);

function isQualifiedRefNamespace(
  segment: string,
): segment is QualifiedRefNamespace {
  return QUALIFIED_REF_NAMESPACES.has(segment);
}

function isCommittedMediaExtension(
  extension: string,
): extension is CommittedMediaExtension {
  return COMMITTED_MEDIA_EXTENSIONS.has(extension);
}

const SEARCH_BY_PATH_MODE: ReadonlyMap<string, string> = new Map([
  [BLOB_PATH_MODE, BLOB_RAW_QUERY],
  [RAW_PATH_MODE, ""],
]);

function parseUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function hasBareAuthority(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.hash === ""
  );
}

function splitAddress(url: URL): AddressParts | undefined {
  const [, owner = "", repo = "", ...rest] = url.pathname.split("/");
  if (url.hostname === RAW_CONTENT_HOST) {
    if (url.search !== "") {
      return undefined;
    }
    return { owner, repo, encodedSegments: rest };
  }
  if (url.hostname !== GITHUB_HOST) {
    return undefined;
  }

  const [mode = "", ...encodedSegments] = rest;
  const search = SEARCH_BY_PATH_MODE.get(mode);
  if (search === undefined || url.search !== search) {
    return undefined;
  }
  return { owner, repo, encodedSegments };
}

function decodeSegments(
  encoded: readonly string[],
): readonly string[] | undefined {
  try {
    return encoded.map((segment) => decodeURIComponent(segment));
  } catch {
    return undefined;
  }
}

function isSafePathSegment(segment: string): boolean {
  return (
    segment !== "" &&
    !DOT_SEGMENTS.has(segment) &&
    !UNSAFE_SEGMENT_CHARS.test(segment)
  );
}

function isSafePath(segments: readonly string[]): boolean {
  const withinBound =
    segments.join("/").length <= COMMITTED_FILE_PATH_MAX_LENGTH;
  return withinBound && segments.every(isSafePathSegment);
}

/**
 * `github.com/<owner>/<repo>/blob/<ref>/<path>?raw=true`,
 * `github.com/<owner>/<repo>/raw/<ref>/<path>` and
 * `raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>`, in any repository.
 * A path that escapes its segments is refused before anything reaches GitHub.
 */
export function parseCommittedFileUrl(url: string): ParseResult {
  const parsed = parseUrl(url);
  if (parsed === undefined || !hasBareAuthority(parsed)) {
    return NOT_A_COMMITTED_FILE;
  }
  const parts = splitAddress(parsed);
  if (parts === undefined) {
    return NOT_A_COMMITTED_FILE;
  }
  const { owner, repo, encodedSegments } = parts;
  const namesRepository = OWNER_PATTERN.test(owner) && REPO_PATTERN.test(repo);
  if (!namesRepository || encodedSegments.length < MIN_PATH_SEGMENTS) {
    return NOT_A_COMMITTED_FILE;
  }

  const pathSegments = decodeSegments(encodedSegments);
  if (pathSegments === undefined || !isSafePath(pathSegments)) {
    return UNSAFE_PATH;
  }
  return { ok: true, value: { owner, repo, pathSegments } };
}

/** The one address every form normalises to: the `raw` form, owner and repo lower-cased as GitHub matches them. */
export function buildCommittedFileUrl(source: CommittedFileSource): string {
  const owner = source.owner.toLowerCase();
  const repo = source.repo.toLowerCase();
  const path = source.pathSegments.map(encodeURIComponent).join("/");
  return `${GITHUB_ORIGIN}/${owner}/${repo}/${RAW_PATH_MODE}/${path}`;
}

/** The namespace a `refs/heads/...` or `refs/tags/...` path names, when a ref name and a file follow it. */
export function readQualifiedRef(
  pathSegments: readonly string[],
): QualifiedRef | undefined {
  const [root, namespace = "", ...unqualifiedSegments] = pathSegments;
  const leavesFile = unqualifiedSegments.length >= MIN_PATH_SEGMENTS;
  const isQualified = root === QUALIFIED_REF_ROOT && leavesFile;
  if (!isQualified || !isQualifiedRefNamespace(namespace)) {
    return undefined;
  }
  return { namespace, unqualifiedSegments };
}

/**
 * A committed file's address in its one form; any other address as written.
 * A fully qualified ref keys as its bare name, so both spellings of one file
 * are one item.
 */
export function normalizeMediaAddress(url: string): string {
  const source = parseCommittedFileUrl(url);
  if (!source.ok) {
    return url;
  }
  const qualified = readQualifiedRef(source.value.pathSegments);
  if (qualified === undefined) {
    return buildCommittedFileUrl(source.value);
  }
  const pathSegments = qualified.unqualifiedSegments;
  return buildCommittedFileUrl({ ...source.value, pathSegments });
}

/** The file lives in `repoSlug` (`owner/name`), matched without case as GitHub does. */
export function isCommittedFileInRepository(
  source: CommittedFileSource,
  repoSlug: string,
): boolean {
  const parts = repoSlug.split("/");
  const [owner, repo] = parts;
  if (parts.length !== 2 || owner === undefined || repo === undefined) {
    return false;
  }
  const sameOwner = owner.toLowerCase() === source.owner.toLowerCase();
  return sameOwner && repo.toLowerCase() === source.repo.toLowerCase();
}

/** The served extension a committed file's name ends in, read without case. */
export function readCommittedMediaExtension(
  pathSegments: readonly string[],
): CommittedMediaExtension | undefined {
  const fileName = pathSegments.at(-1) ?? "";
  const dot = fileName.lastIndexOf(".");
  if (dot === -1) {
    return undefined;
  }
  const extension = fileName.slice(dot + 1).toLowerCase();
  return isCommittedMediaExtension(extension) ? extension : undefined;
}

/** The committed-file proxy serves this file's format; the web proxies only these, so any other keeps loading as written. */
export function isServableCommittedFile(source: CommittedFileSource): boolean {
  return readCommittedMediaExtension(source.pathSegments) !== undefined;
}
