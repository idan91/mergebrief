// The four Review Session reads: `session`, `marks`, `narrative`, `context`.
// Pure passthrough GETs: the span flags are the only client-side checks
// (exit 2); the server owns everything else. `session`/`context` take the
// brief span (`--base`/`--head`, via `requireSpan`); `marks` names a
// comparison (`--baseline`/`--head`); `narrative` names a revision hop
// (`--prev-head`/`--head`).
import { ProductQueryIds } from "contract";
import type { ApiClient } from "../client";
import { CliError, ExitCodes } from "../exit";
import type { CommandIo } from "../types";
import { buildRequestPath } from "./request-path";
import type { BriefSpan } from "./write";

export interface ComparisonSpan {
  readonly baseline: string;
  readonly head: string;
}

export interface NarrativeSpan {
  readonly prevHead: string;
  readonly head: string;
}

export function requireComparisonSpan(
  baseline: string | undefined,
  head: string | undefined,
): ComparisonSpan {
  if (!baseline || !head) {
    throw new CliError(
      ExitCodes.USAGE,
      "--baseline and --head are required — name the comparison span (see `mergebrief pr <n>` revisions); it is never auto-fetched",
    );
  }
  return { baseline, head };
}

export function requireNarrativeSpan(
  prevHead: string | undefined,
  head: string | undefined,
): NarrativeSpan {
  if (!prevHead || !head) {
    throw new CliError(
      ExitCodes.USAGE,
      "--prev-head and --head are required — name the revision hop (see `mergebrief pr <n>` revisions); it is never auto-fetched",
    );
  }
  return { prevHead, head };
}

async function passthroughGet(
  client: ApiClient,
  path: string,
  io: CommandIo,
): Promise<void> {
  const response = await client.request({ path });
  if (io.json) {
    io.stdout(response.bodyText); // verbatim, not one byte more
    return;
  }
  io.stdout(`${response.bodyText}\n`);
}

/** `session <n>`: the reviewer's session on the Brief at (base, head). */
export async function runSession(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  span: BriefSpan,
  io: CommandIo,
): Promise<void> {
  await passthroughGet(
    client,
    buildRequestPath(
      ProductQueryIds.READ_REVIEW_SESSION,
      { repoId, prNumber },
      { base: span.base, head: span.head },
    ),
    io,
  );
}

/** `marks <n>`: comparison marks for (baseline, head). */
export async function runMarks(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  span: ComparisonSpan,
  io: CommandIo,
): Promise<void> {
  await passthroughGet(
    client,
    buildRequestPath(
      ProductQueryIds.READ_MARKS,
      { repoId, prNumber },
      { baseline: span.baseline, head: span.head },
    ),
    io,
  );
}

/** `narrative <n>`: the revision narrative for (prevHead, head). */
export async function runNarrative(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  span: NarrativeSpan,
  io: CommandIo,
): Promise<void> {
  await passthroughGet(
    client,
    buildRequestPath(
      ProductQueryIds.READ_NARRATIVE,
      { repoId, prNumber },
      { prevHead: span.prevHead, head: span.head },
    ),
    io,
  );
}

/** `context <n>`: the brief's repo-config snapshot for (base, head). */
export async function runContext(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  span: BriefSpan,
  io: CommandIo,
): Promise<void> {
  await passthroughGet(
    client,
    buildRequestPath(
      ProductQueryIds.READ_BRIEF_CONTEXT,
      { repoId, prNumber },
      { base: span.base, head: span.head },
    ),
    io,
  );
}
