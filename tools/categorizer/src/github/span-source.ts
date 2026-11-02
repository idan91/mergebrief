import { z } from "zod/v4";
import type { PrLocator } from "brief-core";
import { execFileAsync, MAX_BUFFER } from "brief-core/gh-exec";
import {
  BlobReadKinds,
  PrSpanFailureKinds,
  type BlobRead,
  type BlobRef,
  type PrDiffRef,
  type PrSpanFailure,
  type PrSpanSource,
} from "brief-core/pr-span";
import { HttpStatuses } from "types/http";
import type { Result } from "types/utils";
import { isCommitish, repoSlug } from "./fetch";

const HTTP_STATUS_PATTERN = /\(HTTP (\d{3})\)/;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;
/** GitHub refuses to render a diff this size. */
const TOO_LARGE_STATUSES = new Set<number>([
  HttpStatuses.NOT_ACCEPTABLE,
  HttpStatuses.UNPROCESSABLE_CONTENT,
]);
/** The ref is gone or the token cannot read it; a retry will not help. */
const UNAVAILABLE_STATUSES = new Set<number>([
  HttpStatuses.UNAUTHORIZED,
  HttpStatuses.FORBIDDEN,
  HttpStatuses.NOT_FOUND,
]);

const ContentsFileSchema = z.object({
  type: z.string(),
  size: z.number().int().nonnegative(),
  encoding: z.string().optional(),
  content: z.string().optional(),
});

/**
 * The revision span read through `gh`, for the capture script and the dev
 * CLIs: PR diffs and merge bases from the compare endpoint, blobs from the
 * contents API.
 */
export function buildGhPrSpanSource(loc: PrLocator): PrSpanSource {
  return {
    fetchPrDiff: (span, signal) => fetchGhPrDiff(loc, span, signal),
    fetchBlob: (blob, signal) => fetchGhBlob(loc, blob, signal),
    fetchMergeBase: (span, signal) => fetchGhMergeBase(loc, span, signal),
  };
}

function assertCommitShas(span: PrDiffRef): void {
  if (!isCommitish(span.base) || !isCommitish(span.head)) {
    throw new Error(
      `base/head must be hex commit SHAs; got "${span.base}" / "${span.head}"`,
    );
  }
}

async function fetchGhMergeBase(
  loc: PrLocator,
  span: PrDiffRef,
  signal: AbortSignal,
): Promise<Result<string, PrSpanFailure>> {
  assertCommitShas(span);
  let stdout: string;
  try {
    const read = await execFileAsync(
      "gh",
      [
        "api",
        `repos/${repoSlug(loc)}/compare/${span.base}...${span.head}?per_page=1`,
        "--jq",
        ".merge_base_commit.sha",
      ],
      { maxBuffer: MAX_BUFFER, signal },
    );
    stdout = read.stdout;
  } catch (error) {
    signal.throwIfAborted();
    return { ok: false, error: { kind: readFailureKind(readGhStatus(error)) } };
  }

  const sha = stdout.trim();
  if (!FULL_SHA_PATTERN.test(sha)) {
    return { ok: false, error: { kind: PrSpanFailureKinds.TRANSIENT } };
  }
  return { ok: true, value: sha };
}

async function fetchGhPrDiff(
  loc: PrLocator,
  span: PrDiffRef,
  signal: AbortSignal,
): Promise<Result<string, PrSpanFailure>> {
  assertCommitShas(span);
  try {
    const { stdout } = await execFileAsync(
      "gh",
      [
        "api",
        `repos/${repoSlug(loc)}/compare/${span.base}...${span.head}`,
        "-H",
        "Accept: application/vnd.github.diff",
      ],
      { maxBuffer: MAX_BUFFER, signal },
    );
    return { ok: true, value: stdout };
  } catch (error) {
    signal.throwIfAborted();
    return { ok: false, error: { kind: readFailureKind(readGhStatus(error)) } };
  }
}

async function fetchGhBlob(
  loc: PrLocator,
  blob: BlobRef,
  signal: AbortSignal,
): Promise<Result<BlobRead, PrSpanFailure>> {
  const path = blob.path.split("/").map(encodeURIComponent).join("/");
  let stdout: string;
  try {
    const read = await execFileAsync(
      "gh",
      ["api", `repos/${repoSlug(loc)}/contents/${path}?ref=${blob.ref}`],
      { maxBuffer: MAX_BUFFER, signal },
    );
    stdout = read.stdout;
  } catch (error) {
    signal.throwIfAborted();
    const status = readGhStatus(error);
    if (status === HttpStatuses.NOT_FOUND) {
      return { ok: true, value: { kind: BlobReadKinds.ABSENT } };
    }
    return { ok: false, error: { kind: readFailureKind(status) } };
  }

  const json = parseJson(stdout);
  if (!json.ok) {
    return { ok: false, error: { kind: PrSpanFailureKinds.TRANSIENT } };
  }
  return { ok: true, value: readContentsBlob(json.value, blob.maxBytes) };
}

function parseJson(text: string): Result<unknown, string> {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

/** A contents API answer as a blob read; anything but an inlined UTF-8 file is unreadable. */
function readContentsBlob(answer: unknown, maxBytes: number): BlobRead {
  const parsed = ContentsFileSchema.safeParse(answer);
  if (!parsed.success) {
    return { kind: BlobReadKinds.UNREADABLE };
  }
  const file = parsed.data;
  const inlined = file.encoding === "base64" && file.content !== undefined;
  if (file.type !== "file" || file.size > maxBytes || !inlined) {
    return { kind: BlobReadKinds.UNREADABLE };
  }

  const bytes = Buffer.from(file.content ?? "", "base64");
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { kind: BlobReadKinds.TEXT, content };
  } catch {
    return { kind: BlobReadKinds.UNREADABLE };
  }
}

/** The HTTP status gh printed for a failed call, if it printed one. */
function readGhStatus(error: unknown): number | undefined {
  const stderr =
    typeof error === "object" && error !== null
      ? Reflect.get(error, "stderr")
      : undefined;
  const text = typeof stderr === "string" ? stderr : String(error);
  const match = HTTP_STATUS_PATTERN.exec(text);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function readFailureKind(status: number | undefined): PrSpanFailure["kind"] {
  if (status !== undefined && TOO_LARGE_STATUSES.has(status)) {
    return PrSpanFailureKinds.TOO_LARGE;
  }
  if (status !== undefined && UNAVAILABLE_STATUSES.has(status)) {
    return PrSpanFailureKinds.UNAVAILABLE;
  }
  return PrSpanFailureKinds.TRANSIENT;
}
