// `draft attach`: post an image through the API's upload route and answer
// the branch URL a comment carries. With `--draft` the URL is also appended
// to a held draft's body, so an agent can attach in one call.
import type { ApiClient } from "../client";
import { CliError, ExitCodes } from "../exit";
import type { BriefSpan } from "./write";
import { spanQuery } from "./write";
import type { ReadIo } from "./read";

/**
 * The server validates the bytes; the leading bytes only pick the declared
 * type, so a file of any other kind is sent as-is and the server's refusal
 * relays, like every other 4xx.
 */
const OCTET_STREAM = "application/octet-stream";
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const GIF_SIGNATURE = [0x47, 0x49, 0x46, 0x38];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_TAG = [0x57, 0x45, 0x42, 0x50];
const WEBP_TAG_OFFSET = 8;

export interface AttachmentFile {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

export interface AttachDraftTarget {
  readonly draftId: string;
  readonly span: BriefSpan;
}

export interface AttachOptions {
  readonly repoId: string;
  readonly prNumber: number;
  readonly file: AttachmentFile;
  readonly draft?: AttachDraftTarget | undefined;
}

function startsWith(
  bytes: Uint8Array,
  signature: readonly number[],
  offset = 0,
): boolean {
  const signatureFits = offset + signature.length <= bytes.byteLength;
  if (!signatureFits) {
    return false;
  }
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** The image type the leading bytes declare; anything else goes up untyped. */
export function resolveAttachmentMediaType(bytes: Uint8Array): string {
  if (startsWith(bytes, PNG_SIGNATURE)) {
    return "image/png";
  }
  if (startsWith(bytes, JPEG_SIGNATURE)) {
    return "image/jpeg";
  }
  if (startsWith(bytes, GIF_SIGNATURE)) {
    return "image/gif";
  }
  if (
    startsWith(bytes, RIFF_SIGNATURE) &&
    startsWith(bytes, WEBP_TAG, WEBP_TAG_OFFSET)
  ) {
    return "image/webp";
  }
  return OCTET_STREAM;
}

/** The markdown line that puts the image in a comment. */
export function buildImageMarkdown(url: string): string {
  return `![Image](${url})`;
}

export function appendImageToBody(body: string, url: string): string {
  const line = buildImageMarkdown(url);
  return body.trim() === "" ? line : `${body.trimEnd()}\n\n${line}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readUploadedUrl(bodyText: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    throw new CliError(ExitCodes.GENERIC, "upload receipt was not json");
  }
  const url = isRecord(parsed) ? parsed["url"] : undefined;
  if (typeof url !== "string") {
    throw new CliError(ExitCodes.GENERIC, "upload receipt carried no url");
  }
  return url;
}

/** The held draft's current body, read from the session the span names. */
async function readDraftBody(
  client: ApiClient,
  options: AttachOptions,
  draft: AttachDraftTarget,
): Promise<string> {
  const response = await client.request({
    path: `/api/repos/${options.repoId}/pulls/${options.prNumber}/session${spanQuery(draft.span)}`,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.bodyText);
  } catch {
    throw new CliError(ExitCodes.GENERIC, "session payload was not json");
  }
  const drafts = isRecord(parsed) ? parsed["draftComments"] : undefined;
  const held = Array.isArray(drafts)
    ? drafts.find(
        (entry: unknown) => isRecord(entry) && entry["id"] === draft.draftId,
      )
    : undefined;
  const body = isRecord(held) ? held["body"] : undefined;
  if (typeof body !== "string") {
    throw new CliError(
      ExitCodes.NOT_FOUND,
      `draft ${draft.draftId} is not held in this session`,
    );
  }
  return body;
}

/**
 * The draft is checked before the push, so a bad id costs no commit, and
 * read again right before the append, so an edit made during the upload
 * is kept: the update route has no version guard, the last write wins.
 */
async function appendToDraft(
  client: ApiClient,
  options: AttachOptions,
  draft: AttachDraftTarget,
  url: string,
): Promise<void> {
  try {
    const body = await readDraftBody(client, options, draft);
    await client.request({
      method: "PATCH",
      path: `/api/repos/${options.repoId}/pulls/${options.prNumber}/session/comments/${encodeURIComponent(draft.draftId)}${spanQuery(draft.span)}`,
      body: { body: appendImageToBody(body, url) },
    });
  } catch (error) {
    // The image is on the branch already; the one stderr line must carry
    // its url or a retry pushes a second copy.
    if (error instanceof CliError) {
      throw new CliError(
        error.code,
        `${error.message}; the image is at ${url}`,
      );
    }
    throw error;
  }
}

/** POST the bytes; with a draft, PATCH its body too. The upload receipt is the output. */
export async function runAttach(
  client: ApiClient,
  options: AttachOptions,
  io: ReadIo,
): Promise<void> {
  if (options.draft !== undefined) {
    await readDraftBody(client, options, options.draft);
  }

  const uploaded = await client.request({
    method: "POST",
    path: `/api/repos/${options.repoId}/pulls/${options.prNumber}/attachments`,
    bytes: { body: options.file.bytes, contentType: options.file.mediaType },
  });

  if (options.draft !== undefined) {
    const url = readUploadedUrl(uploaded.bodyText);
    await appendToDraft(client, options, options.draft, url);
  }

  if (io.json) {
    io.stdout(uploaded.bodyText); // verbatim receipt: {url}
    return;
  }
  io.stdout(`${uploaded.bodyText}\n`);
}
