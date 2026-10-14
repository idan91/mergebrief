// Submit publishes server-held comments pinned to the reviewed base/head span.
// Only span shape is checked here; server validation failures map to exit 5.
// Pass receipts through verbatim so callers need not parse stderr to recover.
import {
  ProductActionIds,
  ProductOperations,
  type GenerateBriefBody,
  type ReplyToCommentBody,
} from "contract";
import { ReviewOutcomes } from "types/reviews";
import { CliError, ExitCodes } from "../exit";
import type { ApiClient } from "../client";
import { buildRequestPath } from "./request-path";

export interface WriteIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (line: string) => void;
  readonly json: boolean;
}

// ---------------------------------------------------------------------------
// reply
// ---------------------------------------------------------------------------

export interface ReplyOptions {
  readonly pr: number;
  readonly body: string;
}

/** The brief a write names, the same span every session call takes. */
export interface BriefSpan {
  readonly base: string;
  readonly head: string;
}

/** The ONE client-side shape check; the server owns every other rule. */
export function requireSpan(
  base: string | undefined,
  head: string | undefined,
): BriefSpan {
  if (!base || !head) {
    throw new CliError(
      ExitCodes.USAGE,
      "--base and --head are required — name the brief span you reviewed (see `mergebrief pr <n>` baseSha/headSha); it is never auto-fetched",
    );
  }
  return { base, head };
}

/** POST one reply under a review comment; the receipt is passthrough. */
export async function runReply(
  client: ApiClient,
  repoId: string,
  commentId: string,
  options: ReplyOptions,
  io: WriteIo,
): Promise<void> {
  const body: ReplyToCommentBody = { body: options.body };
  const response = await client.request({
    method: ProductOperations[ProductActionIds.REPLY_TO_COMMENT].method,
    path: buildRequestPath(ProductActionIds.REPLY_TO_COMMENT, {
      repoId,
      prNumber: options.pr,
      commentId,
    }),
    body,
  });
  if (io.json) {
    io.stdout(response.bodyText); // verbatim receipt: {commentId}
    return;
  }
  io.stdout(`replied (receipt: ${response.bodyText})\n`);
}

// ---------------------------------------------------------------------------
// thread resolution + ready, span-less GitHub-backed writes
// ---------------------------------------------------------------------------

/** POST resolve/unresolve on a thread's root comment; receipt passthrough. */
export async function runThreadResolution(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  commentId: string,
  resolved: boolean,
  io: WriteIo,
): Promise<void> {
  const operation = resolved
    ? ProductActionIds.RESOLVE_THREAD
    : ProductActionIds.UNRESOLVE_THREAD;
  const response = await client.request({
    method: ProductOperations[operation].method,
    path: buildRequestPath(operation, { repoId, prNumber, commentId }),
  });
  if (io.json) {
    io.stdout(response.bodyText); // verbatim receipt
    return;
  }
  io.stdout(`${response.bodyText}\n`);
}

/** POST mark-ready; its success is a 204, so stdout stays empty. */
export async function runReady(
  client: ApiClient,
  repoId: string,
  prNumber: number,
): Promise<void> {
  await client.request({
    method: ProductOperations[ProductActionIds.MARK_READY].method,
    path: buildRequestPath(ProductActionIds.MARK_READY, { repoId, prNumber }),
  });
}

/**
 * POST generate-brief, URL-box generation, no confirm prompt (the operator's
 * own key, mirroring the web URL box). The 202 body ({repoId, prNumber}) is
 * passthrough.
 */
export async function runGenerate(
  client: ApiClient,
  url: string,
  io: WriteIo,
): Promise<void> {
  const body: GenerateBriefBody = { url };
  const response = await client.request({
    method: ProductOperations[ProductActionIds.GENERATE_BRIEF].method,
    path: buildRequestPath(ProductActionIds.GENERATE_BRIEF, {}),
    body,
  });
  if (io.json) {
    io.stdout(response.bodyText); // verbatim receipt
    return;
  }
  io.stdout(`${response.bodyText}\n`);
}

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

export interface SubmitInput {
  /** Parsed `-F` payload, if one was given. */
  readonly payload?: unknown;
  /** The raw flag: the server validates it, so an unknown value relays its 400. */
  readonly outcome?: string | undefined;
  readonly body?: string | undefined;
}

/** The submit body the convenience flags build when no `-F` payload is given. */
interface SubmitFlagPayload {
  outcome: string;
  body?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Assemble the submit payload. `-F` (file/stdin) and the convenience flags
 * are mutually exclusive, a defined precedence beats a silent merge. The
 * payload carries the outcome and the review body; the comments are the
 * drafts the server holds, so there is nothing here to send them in.
 */
export function buildSubmitPayload(input: SubmitInput): unknown {
  const hasFlags = input.outcome !== undefined || input.body !== undefined;
  if (input.payload !== undefined && hasFlags) {
    throw new CliError(
      ExitCodes.USAGE,
      "-F and the convenience flags (--outcome/--body) are mutually exclusive",
    );
  }
  if (input.payload !== undefined) {
    return input.payload;
  }

  const payload: SubmitFlagPayload = {
    outcome: input.outcome ?? ReviewOutcomes.COMMENT,
  };

  if (input.body !== undefined) {
    payload.body = input.body;
  }

  return payload;
}

/**
 * POST the review; the receipt ({reviewId, commentsDegraded}) is passthrough.
 * Takes the ALREADY-BUILT payload (`buildSubmitPayload`), the caller builds
 * it before any network work so usage errors (exit 2) fire before target
 * resolution can fail with exit 4.
 */
export async function runSubmit(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  span: BriefSpan,
  payload: unknown,
  io: WriteIo,
): Promise<void> {
  const response = await client.request({
    method: ProductOperations[ProductActionIds.SUBMIT_REVIEW].method,
    path: buildRequestPath(
      ProductActionIds.SUBMIT_REVIEW,
      { repoId, prNumber },
      { base: span.base, head: span.head },
    ),
    body: payload,
  });

  // `commentsDegraded` must be PROMINENT in both output modes: the receipt
  // carries it verbatim for --json consumers, and a stderr warning fires in
  // both modes (stderr is free on exit-0 runs, the invariant governs stdout).
  let degraded = false;
  try {
    const parsed: unknown = JSON.parse(response.bodyText);
    degraded = isRecord(parsed) && parsed["commentsDegraded"] === true;
  } catch {
    // Non-JSON receipt: nothing to inspect; passthrough still applies.
  }
  if (degraded) {
    io.stderr(
      "WARNING: comment anchors were rejected upstream — your comments were folded into the review body (commentsDegraded: true)",
    );
  }

  if (io.json) {
    io.stdout(response.bodyText); // verbatim receipt
    return;
  }
  io.stdout(`review submitted (receipt: ${response.bodyText})\n`);
}
