// The four Review Session reads: `session`, `marks`, `narrative`, `context`.
// Pure passthrough GETs: the span flags are the only client-side checks
// (exit 2); the server owns everything else. `session`/`context` take a brief
// (`commands/span`); `marks` names a comparison (`--baseline`/`--head`);
// `narrative` names a revision hop (`--prev-head`/`--head`).
import { AttentionItemKinds, ProductQueryIds } from "contract";
import { z } from "zod/v4";
import type { ApiClient } from "../../client";
import { CliError, ExitCodes } from "../../exit";
import { buildRequestPath } from "../request-path";
import type { BriefSpan, CommandIo } from "../../types";

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
      "--baseline and --head are required: name the comparison span (see `mergebrief pr <n> --json` revisions); it is never auto-fetched",
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
      "--prev-head and --head are required: name the revision hop (see `mergebrief pr <n> --json` revisions); it is never auto-fetched",
    );
  }
  return { prevHead, head };
}

async function passthroughGet(
  client: ApiClient,
  path: string,
  io: CommandIo,
): Promise<string> {
  const { bodyText } = await client.request({ path });
  // Verbatim under `--json`, not one byte more.
  io.stdout(io.json ? bodyText : `${bodyText}\n`);
  return bodyText;
}

const sessionWorkSliceSchema = z.object({
  materialized: z.boolean(),
  carriedFrom: z.object({ items: z.number() }).nullable(),
  attention: z.array(z.object({ kind: z.string() })),
});

/** What a reader moved to a newer revision should know about their work; undefined when the body says nothing readable. */
function describeCarriedWork(bodyText: string): string | undefined {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(bodyText);
  } catch {
    return undefined;
  }
  const work = sessionWorkSliceSchema.safeParse(parsedJson);
  if (!work.success) {
    return undefined;
  }

  const { materialized, carriedFrom, attention } = work.data;
  if (carriedFrom === null || carriedFrom.items === 0) {
    return "";
  }

  const carried = materialized
    ? "Your work carried over."
    : "Your work carries over on your next write.";
  const lost = attention.filter(
    (item) => item.kind === AttentionItemKinds.ORPHANED_ANCHOR,
  ).length;
  if (lost === 0) {
    return carried;
  }
  return lost === 1
    ? `${carried} 1 draft lost its lines: re-anchor it in MergeBrief.`
    : `${carried} ${lost} drafts lost their lines: re-anchor them in MergeBrief.`;
}

/**
 * `session <n>`: the reviewer's session on the Brief at (base, head). Answers
 * what it read about the reviewer's carried work, for the moved message.
 */
export async function runSession(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  span: BriefSpan,
  io: CommandIo,
): Promise<string | undefined> {
  const bodyText = await passthroughGet(
    client,
    buildRequestPath(
      ProductQueryIds.READ_REVIEW_SESSION,
      { repoId, prNumber },
      { base: span.base, head: span.head },
    ),
    io,
  );
  return describeCarriedWork(bodyText);
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
