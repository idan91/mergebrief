// The write commands (BRIEF-17 PR 7, plan decision 4): `reply` and `submit`.
// Thin POSTs over the server's locked validation — the CLI performs exactly
// ONE client-side shape check (`commitId` present, exit 2) and relays
// everything else: a 4xx validation rejection maps to exit 5, which is what
// makes an agent's submit loop self-correcting without stderr parsing
// (ADR 0029 #6). Receipts pass through VERBATIM.
import { CliError, ExitCode } from "./exit";
import type { ApiClient } from "./client";

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
  readonly commit?: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Assemble the submit payload. `-F` (file/stdin) and the convenience flags
 * are mutually exclusive — a defined precedence beats a silent merge (the
 * invisible-mode-gates rule: behavior follows what the invocation visibly
 * says). The ONE client-side shape check: `commitId` must be present
 * (exit 2) — it is never auto-fetched (plan decision 4: the reviewer pins
 * the commit they actually read); the server owns every other rule.
 */
export function buildSubmitPayload(input: SubmitInput): unknown {
  const hasFlags =
    input.outcome !== undefined || input.body !== undefined || input.commit !== undefined;
  if (input.payload !== undefined && hasFlags) {
    throw new CliError(
      ExitCode.USAGE,
      "-F and the convenience flags (--outcome/--body/--commit) are mutually exclusive",
    );
  }

  if (input.payload !== undefined) {
    // The ONE client-side shape check (codex PR67 R1: one check, one error):
    // commitId must be present — everything else, including a payload the
    // server would reject wholesale, flows through; server validation owns
    // the rest (exit 5, the self-correcting arm).
    if (
      !isRecord(input.payload) ||
      typeof input.payload["commitId"] !== "string" ||
      input.payload["commitId"] === ""
    ) {
      throw new CliError(
        ExitCode.USAGE,
        "the payload must carry commitId — pin the head you actually reviewed (see `mergebrief pr <n>` headSha); it is never auto-fetched",
      );
    }
    return input.payload;
  }

  // Convenience flags: a comment-less review.
  if (input.commit === undefined || input.commit === "") {
    throw new CliError(
      ExitCode.USAGE,
      "--commit is required — pin the head you actually reviewed (see `mergebrief pr <n>` headSha); it is never auto-fetched",
    );
  }
  return {
    outcome: input.outcome ?? "comment",
    commitId: input.commit,
    ...(input.body === undefined ? {} : { body: input.body }),
  };
}

/** POST the review; the receipt ({reviewId, commentsDegraded}) is passthrough. */
export async function runSubmit(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  input: SubmitInput,
  io: WriteIo,
): Promise<void> {
  const payload = buildSubmitPayload(input);
  const response = await client.request({
    method: "POST",
    path: `/api/repos/${repoId}/pulls/${prNumber}/review`,
    body: payload,
  });

  // `commentsDegraded` must be PROMINENT in both output modes (plan decision
  // 4): the receipt carries it verbatim for --json consumers, and a stderr
  // warning fires in both modes (stderr is free on exit-0 runs — the
  // invariant governs stdout).
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
