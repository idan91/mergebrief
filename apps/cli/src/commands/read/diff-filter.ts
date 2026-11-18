// The `--group` hunk-level filter: join a change-group's brief chunk ranges
// against unified-diff hunk headers and keep WHOLE hunks only, never
// trimmed, so the output is itself a valid diff (`git apply --check` clean).
// `addedRanges` join the hunk's NEW side, `removedRanges` its OLD side. Chunk
// files absent from the diff are reported so the command can fail loud rather
// than silently under-show.
import {
  HUNK_HEADER,
  parsePatchPaths,
  POST_SIDE_PREFIX,
  PRE_SIDE_PREFIX,
  readGitPath,
} from "brief-core/chunk-layout";

/** The slice of a brief chunk the filter needs (new-side file path). */
export interface ChunkSpan {
  readonly file: string;
  readonly addedRanges: ReadonlyArray<{
    readonly start: number;
    readonly end: number;
  }>;
  readonly removedRanges: ReadonlyArray<{
    readonly start: number;
    readonly end: number;
  }>;
}

interface Hunk {
  /** Every line of the hunk, header included; emitted verbatim when kept. */
  readonly lines: string[];
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
}

interface FileSection {
  /** Header lines up to the first hunk (diff --git, index, ---, +++, …). */
  readonly header: string[];
  /** The NEW-side path (b/…), or the old path for deletions. */
  readonly newPath: string | undefined;
  readonly hunks: Hunk[];
}

/** The path a `---` or `+++` line names past `side`, git's C-quoting decoded; `/dev/null` names none. */
function parsePath(
  line: string,
  prefix: string,
  side: string,
): string | undefined {
  if (!line.startsWith(prefix)) {
    return undefined;
  }
  return readGitPath(line.slice(prefix.length).trimEnd(), side);
}

function parseSections(diffText: string): FileSection[] {
  const lines = diffText.split("\n");
  const sections: FileSection[] = [];
  let current:
    | { header: string[]; newPath: string | undefined; hunks: Hunk[] }
    | undefined;
  let hunk:
    | {
        lines: string[];
        oldStart: number;
        oldCount: number;
        newStart: number;
        newCount: number;
      }
    | undefined;

  const closeHunk = (): void => {
    if (hunk !== undefined && current !== undefined) {
      current.hunks.push(hunk);
    }
    hunk = undefined;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      closeHunk();
      current = { header: [line], newPath: undefined, hunks: [] };
      sections.push(current);
      continue;
    }
    if (current === undefined) {
      continue; // preamble before the first file section
    }
    const headerMatch = HUNK_HEADER.exec(line);
    if (headerMatch !== null) {
      closeHunk();
      hunk = {
        lines: [line],
        oldStart: Number(headerMatch[1]),
        oldCount: headerMatch[2] === undefined ? 1 : Number(headerMatch[2]),
        newStart: Number(headerMatch[3]),
        newCount: headerMatch[4] === undefined ? 1 : Number(headerMatch[4]),
      };
      continue;
    }
    if (hunk !== undefined) {
      hunk.lines.push(line);
      continue;
    }
    // Still in the file header.
    current.header.push(line);
    const newPath = parsePath(line, "+++ ", POST_SIDE_PREFIX);
    if (newPath !== undefined) {
      current.newPath = newPath;
    } else if (current.newPath === undefined) {
      const oldPath = parsePath(line, "--- ", PRE_SIDE_PREFIX);
      if (oldPath !== undefined) {
        current.newPath = oldPath; // deletion: /dev/null new side
      }
    }
  }
  closeHunk();
  return sections;
}

/**
 * The path the brief's chunks name this file by: its header's post path, as
 * the brief's own split reads it. A name git keeps quoted spells its `---`
 * line with `a/` and its header's post side with `b/`. A file with no hunks
 * (binary, pure rename, mode change) has no `---` or `+++` line, so its
 * header is the only place that names it.
 */
function readChunkPath(section: FileSection): string | undefined {
  return parsePatchPaths(section.header.join("\n"))?.post ?? section.newPath;
}

function rangesIntersect(
  start: number,
  count: number,
  ranges: ReadonlyArray<{ readonly start: number; readonly end: number }>,
): boolean {
  if (count <= 0) {
    return false;
  } // an empty side never matches
  const end = start + count - 1;
  return ranges.some((range) => range.start <= end && start <= range.end);
}

export interface FilteredDiff {
  /** A VALID unified diff: whole kept hunks + their file headers. */
  readonly diff: string;
  /** Chunk files that never appeared in the diff: the fail-loud signal. */
  readonly missingFiles: string[];
}

export function filterDiffByChunks(
  diffText: string,
  chunks: ReadonlyArray<ChunkSpan>,
): FilteredDiff {
  const byFile = new Map<string, ChunkSpan[]>();
  for (const chunk of chunks) {
    const list = byFile.get(chunk.file) ?? [];
    list.push(chunk);
    byFile.set(chunk.file, list);
  }

  const sections = parseSections(diffText);
  const seenFiles = new Set<string>();
  const out: string[] = [];

  for (const section of sections) {
    const chunkPath = readChunkPath(section);
    const fileChunks =
      chunkPath === undefined ? undefined : byFile.get(chunkPath);
    if (fileChunks === undefined || chunkPath === undefined) {
      continue;
    }
    seenFiles.add(chunkPath);
    const kept = section.hunks.filter((h) =>
      fileChunks.some(
        (chunk) =>
          rangesIntersect(h.newStart, h.newCount, chunk.addedRanges) ||
          rangesIntersect(h.oldStart, h.oldCount, chunk.removedRanges),
      ),
    );
    // A file with no hunks is its header: that stanza is the whole change.
    const showsFile = kept.length > 0 || section.hunks.length === 0;
    if (!showsFile) {
      continue;
    }
    out.push(...section.header);
    for (const h of kept) {
      out.push(...h.lines);
    }
  }

  const missingFiles = [...byFile.keys()].filter(
    (file) => !seenFiles.has(file),
  );
  const body = out.join("\n");
  return { diff: body.length === 0 ? "" : `${body}\n`, missingFiles };
}
