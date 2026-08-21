// `reply` and `submit` — thin POSTs over the server's locked validation.
// `reply` carries the text it posts; `submit` PUBLISHES the comments the
// server already holds and NAMES the brief span it reviewed (`--base`/
// `--head`, the ONE client-side shape check, exit 2). Everything else is
// relayed: a 4xx validation rejection maps to exit 5, which is what makes an
// agent's submit loop self-correcting without stderr parsing. Receipts pass
// through VERBATIM.
import { CliError, ExitCode } from "../exit";
import type { ApiClient } from "../client";

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

/** The brief a write names — the same span every session call takes. */
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
      ExitCode.USAGE,
      "--base and --head are required — name the brief span you reviewed (see `mergebrief pr <n>` baseSha/headSha); it is never auto-fetched",
    );
  }
  return { base, head };
}

function spanQuery(span: BriefSpan): string {
  return `?base=${encodeURIComponent(span.base)}&head=${encodeURIComponent(span.head)}`;
}

/** POST one reply under a review comment; the receipt is passthrough. */
export async function runReply(
  client: ApiClient,
  repoId: string,
  commentId: string,
  options: ReplyOptions,
  io: WriteIo,
): Promise<void> {
  const response = await client.request({
    method: "POST",
    path: `/api/repos/${repoId}/pulls/${options.pr}/comments/${encodeURIComponent(commentId)}/replies`,
    body: { body: options.body },
  });
  if (io.json) {
    io.stdout(response.bodyText); // verbatim receipt: {commentId}
    return;
  }
  io.stdout(`replied (receipt: ${response.bodyText})\n`);
}

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

export interface SubmitInput {
  /** Parsed `-F` payload, if one was given. */
  readonly payload?: unknown;
  readonly outcome?: string | undefined;
  readonly body?: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Assemble the submit payload. `-F` (file/stdin) and the convenience flags
 * are mutually exclusive — a defined precedence beats a silent merge. The
 * payload carries the outcome and the review body; the comments are the
 * drafts the server holds, so there is nothing here to send them in.
 */
export function buildSubmitPayload(input: SubmitInput): unknown {
  const hasFlags = input.outcome !== undefined || input.body !== undefined;
  if (input.payload !== undefined && hasFlags) {
    throw new CliError(
      ExitCode.USAGE,
      "-F and the convenience flags (--outcome/--body) are mutually exclusive",
    );
  }
  if (input.payload !== undefined) {
    return input.payload;
  }
  return {
    outcome: input.outcome ?? "comment",
    ...(input.body === undefined ? {} : { body: input.body }),
  };
}

/**
 * POST the review; the receipt ({reviewId, commentsDegraded}) is passthrough.
 * Takes the ALREADY-BUILT payload (`buildSubmitPayload`) — the caller builds
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
    method: "POST",
    path: `/api/repos/${repoId}/pulls/${prNumber}/review${spanQuery(span)}`,
    body: payload,
  });

  // `commentsDegraded` must be PROMINENT in both output modes: the receipt
  // carries it verbatim for --json consumers, and a stderr warning fires in
  // both modes (stderr is free on exit-0 runs — the invariant governs stdout).
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
