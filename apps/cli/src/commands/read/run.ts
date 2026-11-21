// The read commands: `pr [n]`, `groups`, `conversation`, `diff` (+ `--group`
// hunk filter), `delta`. Passthrough by default; `delta` is one of the
// CLI-synthesized shapes. One command may make two API reads (`delta` =
// pr-meta → delta; `diff --group` = brief + diff).
import { formatDisplayPath, formatDisplayText } from "brief-core/hidden-chars";
import {
  DIFF_MODE_HEADER,
  DiffModes,
  ProductOperations,
  ProductQueryIds,
  type DiffMode,
} from "contract";
import type { ApiClient } from "../../client";
import type { BriefSpan, CommandIo } from "../../types";
import { CliError, ExitCodes } from "../../exit";
import { readGroupChunks } from "../brief-chunks";
import { fetchPrMeta, isSpanBriefStored } from "../span/pr-meta";
import type { SpanFlags } from "../span/types";
import { filterDiffByChunks, type ChunkSpan } from "./diff-filter";
import { formatHeldLine } from "./held-line";
import { renderTerminalDiff, type TerminalDiffOptions } from "./terminal-diff";
import { buildRequestPath } from "../request-path";
import { isRecord } from "../../utils";

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

/** `pr <n>`: PR-meta, verbatim; a held head adds its `held:` line. */
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
  const { baseSha, headSha, generation } = meta.slice;
  const stored = isSpanBriefStored(meta.slice);
  io.stdout(
    `PR ${prNumber} · brief ${stored ? "available" : "not ready"}` +
      `${baseSha === null || headSha === null ? "" : ` · span ${formatDisplayText(baseSha.slice(0, 7))}..${formatDisplayText(headSha.slice(0, 7))}`}\n`,
  );
  const held = formatHeldLine(
    generation?.status,
    generation?.unmetConditions,
    generation?.unmetConditionsPartial === true,
  );
  if (held !== undefined) {
    io.stdout(held);
  }
}

/** `groups <n>`: the brief artifact body for the span, verbatim. */
export async function runGroups(
  client: ApiClient,
  repoId: string,
  prNumber: number,
  span: BriefSpan,
  io: CommandIo,
): Promise<void> {
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
  readonly group?: string | undefined;
  /** TTY pager hook (cosmetic only, wired by bin); it takes the escaped copy, since many pagers pass escapes through. */
  readonly pager?: ((text: string) => Promise<void>) | undefined;
  /** Present only when stdout is a terminal; absent, stdout gets the raw bytes. */
  readonly terminal?: TerminalDiffOptions | undefined;
}

/** `--group` reads a brief's own chunks, so a custom span has none to filter by. */
export function requireDiffFlags(flags: SpanFlags & DiffOptions): void {
  const customSpan = flags.base !== undefined || flags.head !== undefined;
  if (flags.group !== undefined && customSpan) {
    throw new CliError(
      ExitCodes.USAGE,
      "--group filters the brief's own span, so it cannot be combined with --base/--head",
    );
  }
}

const DIFF_MODE_VALUES: ReadonlySet<string> = new Set(Object.values(DiffModes));

function isDiffMode(value: string): value is DiffMode {
  return DIFF_MODE_VALUES.has(value);
}

/** The read the server says it served; nothing from a server that names none, or one this CLI does not know. */
function readDiffMode(headers: Headers): DiffMode | undefined {
  const value = headers.get(DIFF_MODE_HEADER);
  if (value === null || !isDiffMode(value)) {
    return undefined;
  }
  return value;
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
  span: BriefSpan,
  options: DiffOptions,
  io: CommandIo,
): Promise<void> {
  let groupChunks: ChunkSpan[] | undefined;
  if (options.group !== undefined) {
    groupChunks = await readGroupChunks(
      client,
      { repoId, prNumber, span },
      options.group,
    );
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
      const missingFiles = filtered.missingFiles.map(formatDisplayPath);
      throw new CliError(
        ExitCodes.GENERIC,
        `group "${options.group}" references files missing from the live diff (${missingFiles.join(", ")}). The brief may lag a push; retry after regeneration`,
      );
    }
    text = filtered.diff;
  }

  if (options.pager !== undefined) {
    await options.pager(renderTerminalDiff(text, { color: false }));
  } else if (options.terminal !== undefined) {
    io.stdout(renderTerminalDiff(text, options.terminal));
  } else {
    io.stdout(text);
  }
  const mode = readDiffMode(diff.headers);
  if (mode !== undefined) {
    io.successNotice(`diff mode: ${mode}`);
  }
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
    if (lastReview.deltaUnchanged === true) {
      unavailable("unchanged");
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

/** A server field as a TTY line shows it: text escaped so it cannot drive the terminal. */
function asDisplay(value: unknown): string {
  if (typeof value === "string") {
    return formatDisplayText(value);
  }
  return typeof value === "number" ? String(value) : "?";
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
