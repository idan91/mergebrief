import { truncateToCodeUnits } from "../../context/utils";
import type { IndexedFile, IndexedHunk } from "../../diff/hunk-index/types";
import { OutlineForms, type OutlineForm } from "../../types";
import { renderShortenedFile } from "../shortened";
import type { ShortenedFile } from "../shortened/types";
import { estimateTokens } from "../size";
import { BYTES_PER_TOKEN, SINGLE_CALL_MAX_INPUT_TOKENS } from "../size/consts";
import {
  describePlaceholder,
  listPatchLines,
  redactIndexedFile,
} from "../redacted-diff";
import { sanitizeUntrustedDiff } from "../untrusted-text";
import {
  OUTLINE_LADDER,
  OUTLINE_LIMITS,
  OUTLINE_MAX_INPUT_TOKENS,
} from "./consts";
import type { Outline, OutlineInput, OutlineLimits } from "./types";

const HUNK_MARKER = "[hunk ";
const OUTLINE_INDENT = "  ";

function isChangedLine(line: string): boolean {
  return line.startsWith("+") || line.startsWith("-");
}

function truncateLine(line: string, maxChars: number): string {
  if (line.length <= maxChars) {
    return line;
  }
  const kept = truncateToCodeUnits(line, maxChars);
  return `${kept}... [+${line.length - kept.length} chars]`;
}

function renderMarker(hunk: IndexedHunk): string {
  return `${HUNK_MARKER}${hunk.id}]`;
}

/** Paths are the one title text the patch pass never saw. */
function renderFileTitle(file: IndexedFile): string {
  const path = sanitizeUntrustedDiff(file.path);
  const title = `### ${file.id} ${path} (${file.status}, +${file.added} -${file.removed})`;
  if (file.previousPath === undefined) {
    return title;
  }
  return `${title} renamed from ${sanitizeUntrustedDiff(file.previousPath)}`;
}

function renderFullHunk(file: IndexedFile, hunk: IndexedHunk): string[] {
  if (hunk.header === undefined) {
    return [`${renderMarker(hunk)} ${describePlaceholder(file)}`];
  }
  return [renderMarker(hunk), hunk.header, ...hunk.lines];
}

/** The hunk's changed lines, cut to the form's head and tail past its limit. */
function renderTrimmedLines(
  hunk: IndexedHunk,
  limits: OutlineLimits,
): string[] {
  const changed = hunk.lines.filter(isChangedLine);
  const cut = (line: string): string => truncateLine(line, limits.lineMaxChars);
  if (changed.length <= limits.hunkMaxChangedLines) {
    return changed.map(cut);
  }

  const omitted = changed.length - limits.keepHead - limits.keepTail;
  const tail = limits.keepTail > 0 ? changed.slice(-limits.keepTail) : [];
  return [
    ...changed.slice(0, limits.keepHead).map(cut),
    `... ${omitted} changed lines omitted`,
    ...tail.map(cut),
  ];
}

function renderOutlineHunk(
  file: IndexedFile,
  hunk: IndexedHunk,
  limits: OutlineLimits | undefined,
): string[] {
  const marker = renderMarker(hunk);
  if (hunk.header === undefined) {
    return [`${marker} ${describePlaceholder(file)}`];
  }
  if (limits === undefined) {
    return [`${marker} ${hunk.header} (+${hunk.added} -${hunk.removed})`];
  }
  if (hunk.added === 0) {
    return [
      `${marker} ${hunk.header} (deletion only: ${hunk.removed} lines removed)`,
    ];
  }
  return [`${marker} ${hunk.header}`, ...renderTrimmedLines(hunk, limits)];
}

/**
 * A shortened file carries its file id and no hunk markers: the grouping
 * call assigns it whole. The full form keeps its summary lines; every
 * outline form collapses it to the title line. Each line is sanitized on
 * its own: the path and package names never rode the patch pass.
 */
function renderShortenedLines(
  shortened: ShortenedFile,
  form: OutlineForm,
): string[] {
  const [title = "", ...details] = renderShortenedFile(shortened).map(
    sanitizeUntrustedDiff,
  );
  const titled = `### ${shortened.file.id} ${title}`;
  if (form !== OutlineForms.FULL) {
    return [titled];
  }
  return [titled, ...details.map((line) => `${OUTLINE_INDENT}${line}`)];
}

function renderFileLines(
  file: IndexedFile,
  form: OutlineForm,
  shortened: ShortenedFile | undefined,
): string[] {
  if (shortened !== undefined) {
    return renderShortenedLines({ ...shortened, file }, form);
  }
  if (form === OutlineForms.FILES) {
    const markers = file.hunks.map(renderMarker).join(" ");
    return [`${renderFileTitle(file)} ${markers}`];
  }
  if (form === OutlineForms.FULL) {
    const hunks = file.hunks.flatMap((hunk) => renderFullHunk(file, hunk));
    return [renderFileTitle(file), ...file.headerLines, ...hunks];
  }

  const limits = OUTLINE_LIMITS.get(form);
  const hunks = file.hunks.flatMap((hunk) =>
    renderOutlineHunk(file, hunk, limits),
  );
  return [renderFileTitle(file), ...hunks];
}

/**
 * `redacted` holds the files `redactFile` already sanitized. No pass runs
 * over the join: the outline has no `@@` line starts, so a diff pass could
 * not reset at a hunk and a key block left open would swallow every later
 * file. The markers it adds are ASCII constants.
 */
function renderRedactedOutline(
  redacted: readonly IndexedFile[],
  shortened: OutlineInput["shortened"],
  form: OutlineForm,
): string {
  const blocks = redacted.map((file) => {
    const lines = renderFileLines(file, form, shortened.get(file.id));
    return lines.join("\n");
  });
  return blocks.join("\n\n");
}

function redactFiles(
  input: Pick<OutlineInput, "files" | "shortened">,
): IndexedFile[] {
  return input.files.map((file) =>
    redactIndexedFile(file, input.shortened.has(file.id)),
  );
}

/** The characters of every line a file read in full contributes: never more than its bytes. */
function countFullFormChars(
  redacted: readonly IndexedFile[],
  shortened: OutlineInput["shortened"],
): number {
  let chars = 0;
  for (const file of redacted) {
    if (shortened.has(file.id)) {
      continue;
    }
    for (const line of listPatchLines(file)) {
      chars += line.length + 1;
    }
  }
  return chars;
}

/**
 * The diff as the grouping call reads it in `form`: every file under a
 * `### <fileId>` title, every hunk of a file read in full behind a
 * `[hunk <id>]` marker. Secrets are redacted and the text sanitized as a
 * diff, so the estimate measures what the prompt carries.
 */
export function renderOutline(
  input: Pick<OutlineInput, "files" | "shortened">,
  form: OutlineForm,
): string {
  return renderRedactedOutline(redactFiles(input), input.shortened, form);
}

function measureOutline(
  redacted: readonly IndexedFile[],
  input: OutlineInput,
  form: OutlineForm,
): Outline {
  const text = renderRedactedOutline(redacted, input.shortened, form);
  const rate =
    form === OutlineForms.FULL ? BYTES_PER_TOKEN.DIFF : BYTES_PER_TOKEN.OUTLINE;
  return { form, text, estimatedInputTokens: estimateTokens(text, rate) };
}

/**
 * Walks the ladder: the full diff while it fits a single call's input, then
 * each outline form in turn while it fits the outline budget. The files
 * form is the floor and is taken whatever its size.
 */
export function chooseOutline(input: OutlineInput): Outline {
  const redacted = redactFiles(input);
  if (input.forcedForm !== undefined) {
    return measureOutline(redacted, input, input.forcedForm);
  }

  // The full form is rendered only when its characters alone leave it a chance.
  const fullMaxBytes = SINGLE_CALL_MAX_INPUT_TOKENS * BYTES_PER_TOKEN.DIFF;
  if (countFullFormChars(redacted, input.shortened) <= fullMaxBytes) {
    const full = measureOutline(redacted, input, OutlineForms.FULL);
    if (full.estimatedInputTokens <= SINGLE_CALL_MAX_INPUT_TOKENS) {
      return full;
    }
  }

  let outline: Outline | undefined;
  for (const form of OUTLINE_LADDER) {
    outline = measureOutline(redacted, input, form);
    if (outline.estimatedInputTokens <= OUTLINE_MAX_INPUT_TOKENS) {
      return outline;
    }
  }
  return outline ?? measureOutline(redacted, input, OutlineForms.FILES);
}
