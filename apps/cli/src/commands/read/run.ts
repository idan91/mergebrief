// The read commands: `pr [n]`, `groups`, `conversation`, `diff` (+ `--group`
// hunk filter), `delta`. Passthrough by default; `delta` is one of the
// CLI-synthesized shapes. One command may make two API reads (`delta` =
// pr-meta → delta; `diff --group` = brief + diff).
import { ProductOperations, ProductQueryIds } from "contract";
import { z } from "zod/v4";
import type { ApiClient } from "../../client";
import type { CommandIo } from "../../types";
import { CliError, ExitCodes } from "../../exit";
import { filterDiffByChunks, type ChunkSpan } from "./diff-filter";
import { buildRequestPath } from "../request-path";
import { isRecord } from "../../utils";

// ---------------------------------------------------------------------------
// The PR-meta slices these commands consume (tolerant-read: only the fields
// the CLI actually joins on, everything else passes through untouched).
// ---------------------------------------------------------------------------

const prMetaSliceSchema = z.object({
  baseSha: z.string().nullable(),
  headSha: z.string().nullable(),
  briefAvailable: z.boolean(),
  headBriefStored: z.boolean().optional(),
  comparisons: z
    .object({
      lastReview: z
        .union([
          z.object({
            deltaAvailable: z.boolean(),
            baselineSha: z.string(),
          }),
          z.object({ unavailable: z.string() }),
        ])
        .optional(),
    })
    .optional(),
});

const briefChunkSliceSchema = z.object({
  chunks: z.array(
    z.object({
      changeGroupId: z.string(),
      file: z.string(),
      addedRanges: z.array(z.object({ start: z.number(), end: z.number() })),
      removedRanges: z.array(z.object({ start: z.number(), end: z.number() })),
    }),
  ),
});

function skewError(what: string): CliError {
  return new CliError(
    ExitCodes.GENERIC,
    `the server's ${what} response did not match the documented shape (version skew? check \`mergebrief auth status\`)`,
  );
}

interface PrMetaSlice {
  readonly bodyText: string;
  readonly slice: z.infer<typeof prMetaSliceSchema>;
}

async function fetchPrMeta(
  client: ApiClient,
  repoId: string,
  prNumber: number,
): Promise<PrMetaSlice> {
  const response = await client.request({
    path: buildRequestPath(ProductQueryIds.READ_PULL, { repoId, prNumber }),
  });
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(response.bodyText);
  } catch {
    throw skewError("PR-meta");
  }
  const slice = prMetaSliceSchema.safeParse(parsedJson);
  if (!slice.success) {
    throw skewError("PR-meta");
  }
  return { bodyText: response.bodyText, slice: slice.data };
}

/**
 * A brief is stored at the meta's own span, on whatever base it was built.
 * A server older than `headBriefStored` meant exactly this by
 * `briefAvailable`.
 */
function isSpanBriefStored(slice: PrMetaSlice["slice"]): boolean {
  return slice.headBriefStored ?? slice.briefAvailable;
}

/** The brief's own span, required by `groups` and `diff --group`. */
function briefSpan(
  meta: PrMetaSlice,
  prNumber: number,
): { base: string; head: string } {
  const { baseSha, headSha } = meta.slice;
  const spanStored =
    isSpanBriefStored(meta.slice) && baseSha !== null && headSha !== null;
  if (!spanStored) {
    throw new CliError(
      ExitCodes.NOT_FOUND,
      `no brief generated yet for PR ${prNumber} — generation is webhook-driven; try again after the next push settles`,
    );
  }
  return { base: baseSha, head: headSha };
}

// ---------------------------------------------------------------------------
// Commands. Each takes the resolved client + repoId and the io sinks.
// ---------------------------------------------------------------------------

/** `pr` with no number: the first Inbox page, verbatim. */
export async function runPrList(
  client: ApiClient,
  io: CommandIo,
): Promise<void> {
  const response = await client.request({
    path: ProductOperations[ProductQueryIds.LIST_INBOX].path,
  });
  if (io.json) {
    io.stdout(response.bodyText); // verbatim, not one byte more
    return;
  }
  renderPrList(response.bodyText, io);
}

/** `pr <n>`: PR-meta, verbatim. */
export async function runPrMeta(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  io: CommandIo,
): Promise<void> {
  if (io.json) {
    // TRUE passthrough: the json arm must never parse, a shape the CLI does
    // not recognize still belongs to the consumer.
    const response = await client.request({
      path: buildRequestPath(ProductQueryIds.READ_PULL, { repoId, prNumber }),
    });
    io.stdout(response.bodyText); // verbatim
    return;
  }
  const meta = await fetchPrMeta(client, repoId, prNumber);
  const { baseSha, headSha } = meta.slice;
  const stored = isSpanBriefStored(meta.slice);
  io.stdout(
    `PR ${prNumber} · brief ${stored ? "available" : "not ready"}` +
      `${baseSha === null || headSha === null ? "" : ` · span ${baseSha.slice(0, 7)}..${headSha.slice(0, 7)}`}\n`,
  );
}

/** `groups <n>`: the brief artifact body for the PR's own span, verbatim. */
export async function runGroups(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  io: CommandIo,
): Promise<void> {
  const meta = await fetchPrMeta(client, repoId, prNumber);
  const span = briefSpan(meta, prNumber);
  const brief = await client.request({
    path: buildRequestPath(
      ProductQueryIds.READ_BRIEF,
      { repoId, prNumber },
      { base: span.base, head: span.head },
    ),
  });
  if (io.json) {
    io.stdout(brief.bodyText); // verbatim
    return;
  }
  renderGroups(brief.bodyText, io);
}

/** `conversation <n>`: the PR conversation, verbatim. */
export async function runConversation(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  io: CommandIo,
): Promise<void> {
  const response = await client.request({
    path: buildRequestPath(ProductQueryIds.READ_CONVERSATION, {
      repoId,
      prNumber,
    }),
  });
  if (io.json) {
    io.stdout(response.bodyText); // verbatim
    return;
  }
  io.stdout(`${response.bodyText}\n`);
}

export interface DiffOptions {
  readonly base?: string | undefined;
  readonly head?: string | undefined;
  readonly group?: string | undefined;
  /** TTY pager hook (cosmetic only, wired by bin, absent in tests). */
  readonly pager?: ((text: string) => Promise<void>) | undefined;
}

/** The usage checks `diff` runs on its flags alone, before any network work. */
export function requireDiffFlags(options: DiffOptions): void {
  const customSpan = options.base !== undefined || options.head !== undefined;
  if (options.group !== undefined && customSpan) {
    throw new CliError(
      ExitCodes.USAGE,
      "--group filters the brief's own span — it cannot be combined with --base/--head",
    );
  }
  const loneSpanFlag =
    (options.base === undefined) !== (options.head === undefined);
  if (loneSpanFlag) {
    throw new CliError(
      ExitCodes.USAGE,
      "--base and --head must be given together",
    );
  }
}

/**
 * `diff <n>`: the raw unified diff IS the machine format, `--json` is
 * rejected by the caller (exit 2) before this runs. `--group` filters to a
 * change-group's whole hunks on the brief's OWN span; combining it with a
 * custom `--base`/`--head` is a hard usage error.
 */
export async function runDiff(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  options: DiffOptions,
  io: CommandIo,
): Promise<void> {
  requireDiffFlags(options);

  let span: { base: string; head: string };
  let groupChunks: ChunkSpan[] | undefined;
  if (options.group !== undefined) {
    const meta = await fetchPrMeta(client, repoId, prNumber);
    span = briefSpan(meta, prNumber);
    const brief = await client.request({
      path: buildRequestPath(
        ProductQueryIds.READ_BRIEF,
        { repoId, prNumber },
        { base: span.base, head: span.head },
      ),
    });
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(brief.bodyText);
    } catch {
      throw skewError("brief");
    }
    const parsed = briefChunkSliceSchema.safeParse(parsedJson);
    if (!parsed.success) {
      throw skewError("brief");
    }
    groupChunks = parsed.data.chunks.filter(
      (chunk) => chunk.changeGroupId === options.group,
    );
    if (groupChunks.length === 0) {
      throw new CliError(
        ExitCodes.NOT_FOUND,
        `change group "${options.group}" is not in this PR's brief (see \`mergebrief groups ${prNumber}\`)`,
      );
    }
  } else if (options.base !== undefined && options.head !== undefined) {
    span = { base: options.base, head: options.head };
  } else {
    const meta = await fetchPrMeta(client, repoId, prNumber);
    span = briefSpan(meta, prNumber);
  }

  const diff = await client.request({
    path: buildRequestPath(
      ProductQueryIds.READ_DIFF,
      { repoId, prNumber },
      { base: span.base, head: span.head },
    ),
  });

  let text = diff.bodyText;
  if (groupChunks !== undefined) {
    const filtered = filterDiffByChunks(text, groupChunks);
    if (filtered.missingFiles.length > 0) {
      // Fail LOUD: a silently under-shown group is worse than an error, the
      // brief and the live diff disagree about files.
      throw new CliError(
        ExitCodes.GENERIC,
        `group "${options.group}" references files missing from the live diff (${filtered.missingFiles.join(", ")}) — the brief may lag a push; retry after regeneration`,
      );
    }
    text = filtered.diff;
  }

  if (options.pager !== undefined) {
    await options.pager(text);
    return;
  }
  io.stdout(text);
}

export interface DeltaOptions {
  readonly baseline?: string | undefined;
  readonly head?: string | undefined;
}

/** The usage check `delta` runs on its flags alone, before any network work. */
export function requireDeltaFlags(options: DeltaOptions): void {
  const loneSpanFlag =
    (options.baseline === undefined) !== (options.head === undefined);
  if (loneSpanFlag) {
    throw new CliError(
      ExitCodes.USAGE,
      "--baseline and --head must be given together",
    );
  }
}

/** The `delta` union, one of the CLI-synthesized shapes. */
export async function runDelta(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  options: DeltaOptions,
  io: CommandIo,
): Promise<void> {
  const emit = (payload: string): void => {
    io.stdout(`${payload}\n`);
  };
  const unavailable = (reason: string): void => {
    // Modeled unavailability is DATA, not failure (exit 0).
    emit(JSON.stringify({ available: false, reason }));
  };

  requireDeltaFlags(options);

  let baseline: string;
  let head: string;
  if (options.baseline !== undefined && options.head !== undefined) {
    baseline = options.baseline;
    head = options.head;
  } else {
    // Checkpoint resolution via PR-meta, the CLI's own join, recorded in
    // the envelope's baselineSha.
    const meta = await fetchPrMeta(client, repoId, prNumber);
    const lastReview = meta.slice.comparisons?.lastReview;
    if (lastReview === undefined) {
      unavailable("no-checkpoint");
      return;
    }
    if ("unavailable" in lastReview) {
      unavailable(lastReview.unavailable);
      return;
    }
    if (!lastReview.deltaAvailable) {
      unavailable("delta-not-generated");
      return;
    }
    if (meta.slice.headSha === null) {
      unavailable("baseline-unavailable");
      return;
    }
    baseline = lastReview.baselineSha;
    head = meta.slice.headSha;
  }

  // Unmodeled 404 (the artifact vanished between reads / explicit bad span)
  // stays exit 4, only MODELED unavailability is data.
  const artifact = await client.request({
    path: buildRequestPath(
      ProductQueryIds.READ_DELTA,
      { repoId, prNumber },
      { baseline, head },
    ),
  });
  // Splice the artifact bytes VERBATIM into the envelope, never re-parsed.
  emit(
    `{"available":true,"baselineSha":${JSON.stringify(baseline)},"headSha":${JSON.stringify(head)},"artifact":${artifact.bodyText}}`,
  );
}

/** `collaborators`: the target repo's push-gated roster, verbatim. */
export async function runCollaborators(
  client: ApiClient,
  repoId: string,
  io: CommandIo,
): Promise<void> {
  const response = await client.request({
    path: buildRequestPath(ProductQueryIds.LIST_COLLABORATORS, { repoId }),
  });
  if (io.json) {
    io.stdout(response.bodyText); // verbatim
    return;
  }
  io.stdout(`${response.bodyText}\n`);
}

// ---------------------------------------------------------------------------
// Minimal TTY renderings, explicitly NON-contractual.
// ---------------------------------------------------------------------------

function asDisplay(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "?";
}

function renderPrList(bodyText: string, io: CommandIo): void {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isRecord(parsed) && Array.isArray(parsed["items"])) {
      for (const pull of parsed["items"].filter(isRecord)) {
        const locator = `${asDisplay(pull["repoSlug"])}#${asDisplay(pull["prNumber"])}`;
        const columns = [
          locator,
          asDisplay(pull["title"]),
          asDisplay(pull["state"]),
        ];
        io.stdout(`${columns.join("\t")}\n`);
      }
      return;
    }
  } catch {
    // fall through to raw
  }
  io.stdout(`${bodyText}\n`);
}

function renderGroups(bodyText: string, io: CommandIo): void {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isRecord(parsed) && Array.isArray(parsed["changeGroups"])) {
      for (const group of parsed["changeGroups"].filter(isRecord)) {
        io.stdout(`${asDisplay(group["id"])}\t${asDisplay(group["title"])}\n`);
      }
      return;
    }
  } catch {
    // fall through to raw
  }
  io.stdout(`${bodyText}\n`);
}
