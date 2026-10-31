import type {
  FileId,
  HunkId,
  IndexedFile,
  IndexedHunk,
} from "../../diff/hunk-index/types";
import type { ChangeGroup, LineRange } from "../../types";
import {
  buildPrimaryTicketText,
  DATA_REMINDER,
  readPrimary,
  renderBranchFacts,
  renderLinked,
  renderPrDescription,
  renderPrimaryTicket,
  renderPrTitle,
  REPO_REMINDER,
} from "../categorize";
import { buildDetailSystemPrompt } from "../prompt";
import { describePlaceholder, redactIndexedFile } from "../redacted-diff";
import { stripForgedRepoFences } from "../repo-context";
import { estimateTokens } from "../size";
import { BYTES_PER_TOKEN } from "../size/consts";
import { sanitizeUntrustedText } from "../untrusted-text";
import { DETAIL_BATCH_MAX_DIFF_TOKENS } from "./consts";
import type {
  DetailBatch,
  DetailPrefixInput,
  DetailRequest,
  DetailRequestInput,
  HunkLocation,
  OmittedRanges,
} from "./types";

function renderGroupLine(group: ChangeGroup, hunkCount: number): string {
  const categories = [group.dominantCategory, ...group.secondaryCategories];
  const id = sanitizeUntrustedText(group.id);
  const title = sanitizeUntrustedText(group.title);
  const summary = sanitizeUntrustedText(group.summary);
  return `- ${id} [${categories.join(", ")}] ${title}: ${summary} (${hunkCount} hunks)`;
}

/**
 * The grouping call's output as every detail call reads it: the whole-PR
 * summary and the full group list in reading order, each field sanitized
 * like PR text, inside one fence.
 */
function renderGrouping(input: DetailPrefixInput): string {
  const summary = sanitizeUntrustedText(input.summary);
  const groups = input.groups
    .map((group) => {
      const hunkCount = input.hunksByGroup.get(group.id)?.length ?? 0;
      return renderGroupLine(group, hunkCount);
    })
    .join("\n");
  return `<pr_grouping>
## Whole-PR summary
${summary}

## Change-groups, in reading order (${input.groups.length})
${groups || "(none)"}
</pr_grouping>`;
}

/**
 * The first block of every detail call's user message: the PR text the
 * single call renders, the grouping call's output and the repo's custom
 * attributes. Byte-identical across a run's calls, so the provider caches it.
 */
export function buildDetailPrefix(input: DetailPrefixInput): string {
  const { pr } = input;
  const clean =
    input.repoContext === undefined
      ? (text: string) => text
      : stripForgedRepoFences;
  const primary = readPrimary(pr.primaryTicket);
  const primaryText =
    primary === undefined ? "" : buildPrimaryTicketText(primary);

  return `PR: ${pr.meta.url}
Repo: ${pr.locator.owner}/${pr.locator.repo}
Number: ${pr.locator.number}
Title: ${renderPrTitle(pr.meta)}${renderBranchFacts(pr.meta)}

## Description
${renderPrDescription(pr.meta)}

${clean(renderPrimaryTicket(primary, primaryText))}## Linked context
${clean(renderLinked(pr.links))}${input.attributesBlock}

## Grouping (shared by every batch)
${renderGrouping(input)}`;
}

/** What a cut hunk needs beyond its kept lines: the marker with its group id, and the note. */
const CUT_HUNK_RESERVE_BYTES = 1_024;

function renderOmittedNote(omittedLines: number): string {
  return `[... ${omittedLines} more lines of this hunk not shown: the hunk alone is over one detail call's input budget; its header counts the shown lines, the only ones a chunk may claim]`;
}

/** A hunk header's two sides; the section text after them is any characters, line breaks included. */
const HUNK_HEADER_SIDES = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
/** A side `@@` writes without a count holds one line. */
const DEFAULT_SIDE_COUNT = "1";
const OLD_SIDE_PREFIXES = [" ", "-"];
const NEW_SIDE_PREFIXES = [" ", "+"];

interface CutHeader {
  header: string;
  omittedRanges: OmittedRanges;
}

function countSideLines(
  lines: readonly string[],
  prefixes: readonly string[],
): number {
  return lines.filter((line) =>
    prefixes.some((prefix) => line.startsWith(prefix)),
  ).length;
}

/** A side's lines past the `shown` ones, through its last line. */
function readOmittedRange(
  start: number,
  count: number,
  shown: number,
): LineRange[] {
  const first = start + shown;
  const last = start + count - 1;
  return first <= last ? [{ start: first, end: last }] : [];
}

/** The cut hunk's header counted over `shownLines`, and each side's lines the cut left off. */
function cutHunkHeader(
  header: string,
  shownLines: readonly string[],
): CutHeader {
  const match = HUNK_HEADER_SIDES.exec(header);
  if (match === null) {
    throw new Error("a cut hunk's header no longer parses");
  }
  const [sides, oldStart = "", oldCount = DEFAULT_SIDE_COUNT, newStart = ""] =
    match;
  const newCount = match[4] ?? DEFAULT_SIDE_COUNT;
  const section = header.slice(sides.length);
  const shownOld = countSideLines(shownLines, OLD_SIDE_PREFIXES);
  const shownNew = countSideLines(shownLines, NEW_SIDE_PREFIXES);
  return {
    header: `@@ -${oldStart},${shownOld} +${newStart},${shownNew} @@${section}`,
    omittedRanges: {
      removedRanges: readOmittedRange(
        Number(oldStart),
        Number(oldCount),
        shownOld,
      ),
      addedRanges: readOmittedRange(
        Number(newStart),
        Number(newCount),
        shownNew,
      ),
    },
  };
}

/** A group id is the grouping call's text: shown sanitized, and `restoreRawGroupIds` maps the answer back. */
function renderHunk(location: HunkLocation, groupId: string): string[] {
  const { file, hunk } = location;
  const marker = `[hunk ${hunk.id} -> ${sanitizeUntrustedText(groupId)}]`;
  if (hunk.header === undefined) {
    return [`${marker} ${describePlaceholder(file)}`];
  }
  const lines = [marker, hunk.header, ...hunk.lines];
  if (location.omittedLines !== undefined) {
    lines.push(renderOmittedNote(location.omittedLines));
  }
  return lines;
}

function measureLines(lines: readonly string[]): number {
  return estimateTokens(lines.join("\n"), BYTES_PER_TOKEN.DIFF);
}

/**
 * A hunk with its estimated tokens, counted with its file's header lines.
 * A hunk over `maxTokens` alone keeps the head lines that fit and a note
 * naming how many were left off, so no detail call reads past its budget.
 */
function measureHunk(
  file: IndexedFile,
  hunk: IndexedHunk,
  maxTokens: number,
): HunkLocation {
  const headLines = [...file.headerLines, hunk.header ?? ""];
  const estimatedTokens = measureLines([...headLines, ...hunk.lines]);
  if (estimatedTokens <= maxTokens) {
    return { file, hunk, estimatedTokens };
  }

  const budgetBytes = maxTokens * BYTES_PER_TOKEN.DIFF;
  let bytes = Buffer.byteLength(headLines.join("\n"), "utf8");
  bytes += CUT_HUNK_RESERVE_BYTES;
  let kept = 0;
  for (const line of hunk.lines) {
    bytes += Buffer.byteLength(line, "utf8") + 1;
    if (bytes > budgetBytes) {
      break;
    }
    kept += 1;
  }

  const lines = hunk.lines.slice(0, kept);
  const omittedLines = hunk.lines.length - kept;
  const shown = [...headLines, ...lines, renderOmittedNote(omittedLines)];
  const cut = cutHunkHeader(hunk.header ?? "", lines);
  return {
    file,
    hunk: { ...hunk, header: cut.header, lines },
    estimatedTokens: measureLines(shown),
    omittedLines,
    omittedRanges: cut.omittedRanges,
  };
}

/**
 * Every hunk a detail call may show, by id, over files redacted once per
 * run: the redactor reads a file's whole patch, so a file whose hunks span
 * several batches is still sanitized one time, and a hunk is cut only after
 * it. Shortened files are left out; no detail call shows their code.
 */
export function indexDetailHunks(
  files: readonly IndexedFile[],
  shortenedFileIds: ReadonlySet<FileId>,
  maxHunkTokens: number = DETAIL_BATCH_MAX_DIFF_TOKENS,
): Map<HunkId, HunkLocation> {
  const locations = new Map<HunkId, HunkLocation>();
  for (const file of files) {
    if (shortenedFileIds.has(file.id)) {
      continue;
    }
    const clean = redactIndexedFile(file, false);
    for (const hunk of clean.hunks) {
      locations.set(hunk.id, measureHunk(clean, hunk, maxHunkTokens));
    }
  }
  return locations;
}

/** Each indexed hunk's estimated tokens, as the batch planner weighs them. */
export function readHunkTokens(
  locations: ReadonlyMap<HunkId, HunkLocation>,
): Map<HunkId, number> {
  const tokens = new Map<HunkId, number>();
  for (const [hunkId, location] of locations) {
    tokens.set(hunkId, location.estimatedTokens);
  }
  return tokens;
}

/** The batch's hunks with their full redacted code, each file under its own diff header, every hunk behind a group marker. */
function renderBatchDiff(
  batch: DetailBatch,
  locations: ReadonlyMap<HunkId, HunkLocation>,
): string {
  const out: string[] = [];
  for (const part of batch.parts) {
    let currentFile: FileId | undefined;
    for (const hunkId of part.hunkIds) {
      const location = locations.get(hunkId);
      if (location === undefined) {
        continue;
      }
      if (location.file.id !== currentFile) {
        currentFile = location.file.id;
        out.push(...location.file.headerLines);
      }
      out.push(...renderHunk(location, part.groupId));
    }
  }
  return out.join("\n");
}

function describeBatch(batch: DetailBatch, batchCount: number): string {
  const position = `${batch.index + 1} of ${batchCount}`;
  if (batch.half === undefined) {
    return `## Batch ${position}`;
  }
  return `## Batch ${position}, half ${batch.half}`;
}

/**
 * One detail call: the shared prefix (cached), then this batch's groups
 * and their hunks' full code from the run's redacted index.
 */
export function buildDetailRequest(input: DetailRequestInput): DetailRequest {
  const { batch, batchCount } = input;
  const shownIds = batch.parts.map((part) =>
    sanitizeUntrustedText(part.groupId),
  );
  const groupIds = [...new Set(shownIds)];
  const repoReminder = input.attributesBlock === "" ? "" : REPO_REMINDER;
  const user = `${describeBatch(batch, batchCount)}

Change-groups in this batch: ${groupIds.join(", ")}.

<pr_diff>
${renderBatchDiff(batch, input.locations)}
</pr_diff>

There are ${batch.hunkCount} hunk markers above. Return the chunks for every changed line in them and for nothing else; each chunk's \`changeGroupId\` is the group on its hunk's marker.

${DATA_REMINDER}${repoReminder}`;

  return {
    system: buildDetailSystemPrompt(input.repoContext),
    userPrefix: input.prefix,
    user,
  };
}
