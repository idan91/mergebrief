import "@tanstack/react-start/server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Brief, BriefChunk, DiffLine, LineRange } from "./types";
import { parseBrief } from "./validation";

interface FileDiffSidecar {
  file: string;
  patch: string;
}

interface ParsedFileDiff {
  file: string;
  rows: DiffLine[];
}

const OUT_DIR = resolve(process.cwd(), "../../tools/categorizer/out");
const LOCAL_BRIEF_PATH = resolve(OUT_DIR, "Idan91-flexer-55.brief.json");
const LOCAL_DIFFS_PATH = resolve(OUT_DIR, "Idan91-flexer-55.diffs.json");

export async function readLocalBrief(): Promise<Brief> {
  const raw = await readFile(LOCAL_BRIEF_PATH, "utf8");
  const parsedJson: unknown = JSON.parse(raw);
  const parsedBrief = parseBrief(parsedJson);
  if (!parsedBrief.ok) {
    throw new Error(`Invalid local brief: ${parsedBrief.error}`);
  }
  return attachChunkDiffs(parsedBrief.value);
}

async function attachChunkDiffs(brief: Brief): Promise<Brief> {
  const fileDiffs = await readFileDiffs();
  if (fileDiffs.size === 0) return brief;

  return {
    ...brief,
    chunks: brief.chunks.map((chunk) => {
      const fileDiff = fileDiffs.get(chunk.file);
      if (!fileDiff) return chunk;
      return {
        ...chunk,
        diff: sliceChunkDiff(fileDiff.rows, chunk),
      } satisfies BriefChunk;
    }),
  };
}

async function readFileDiffs(): Promise<Map<string, ParsedFileDiff>> {
  const raw = await readFile(LOCAL_DIFFS_PATH, "utf8");
  const parsedJson: unknown = JSON.parse(raw);
  if (!Array.isArray(parsedJson)) {
    throw new Error("Invalid diffs sidecar: expected an array");
  }

  const diffs = new Map<string, ParsedFileDiff>();
  for (const item of parsedJson) {
    if (!isFileDiffSidecar(item)) {
      throw new Error("Invalid diffs sidecar: expected file and patch strings");
    }
    diffs.set(item.file, { file: item.file, rows: parseUnifiedDiffPatch(item.patch) });
  }
  return diffs;
}

function isFileDiffSidecar(value: unknown): value is FileDiffSidecar {
  return typeof value === "object" && value !== null && "file" in value && "patch" in value && typeof value.file === "string" && typeof value.patch === "string";
}

function sliceChunkDiff(rows: DiffLine[], chunk: BriefChunk): DiffLine[] {
  const changedRows = rows.filter((row) => {
    if (row.kind === "add") return lineInRanges(row.newLine, chunk.addedRanges);
    if (row.kind === "del") return lineInRanges(row.oldLine, chunk.removedRanges);
    return false;
  });
  if (changedRows.length === 0) return [];

  const selected = new Set<DiffLine>();
  for (const changedRow of changedRows) {
    const index = rows.indexOf(changedRow);
    let hunkIndex = index;
    while (hunkIndex >= 0 && rows[hunkIndex]?.kind !== "hunk") {
      hunkIndex -= 1;
    }
    if (hunkIndex >= 0) {
      const hunk = rows[hunkIndex];
      if (hunk) selected.add(hunk);
    }
    for (let offset = -2; offset <= 2; offset += 1) {
      const row = rows[index + offset];
      if (row && (row.kind === "ctx" || row.kind === "add" || row.kind === "del" || row.kind === "note")) {
        selected.add(row);
      }
    }
  }

  return rows.filter((row) => selected.has(row));
}

function lineInRanges(line: number | undefined, ranges: LineRange[]): boolean {
  return typeof line === "number" && ranges.some((range) => line >= range.start && line <= range.end);
}

function parseUnifiedDiffPatch(patch: string): DiffLine[] {
  const rows: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ") || line.startsWith("new file mode ") || line.startsWith("deleted file mode ")) {
      continue;
    }
    if (line.startsWith("@@")) {
      const parsedHunk = parseHunkLine(line);
      oldLine = parsedHunk.oldStart;
      newLine = parsedHunk.newStart;
      rows.push({ kind: "hunk", content: line });
      continue;
    }
    if (line.startsWith("\\ No newline")) {
      rows.push({ kind: "note", content: line });
      continue;
    }
    if (line.startsWith("+")) {
      rows.push({ kind: "add", content: line.slice(1), newLine });
      newLine += 1;
      continue;
    }
    if (line.startsWith("-")) {
      rows.push({ kind: "del", content: line.slice(1), oldLine });
      oldLine += 1;
      continue;
    }
    rows.push({ kind: "ctx", content: line.startsWith(" ") ? line.slice(1) : line, oldLine, newLine });
    oldLine += 1;
    newLine += 1;
  }

  return rows;
}

function parseHunkLine(line: string): { oldStart: number; newStart: number } {
  const match = /^@@ -(?<oldStart>\d+)(?:,\d+)? \+(?<newStart>\d+)(?:,\d+)? @@/.exec(line);
  return {
    oldStart: Number(match?.groups?.["oldStart"] ?? 0),
    newStart: Number(match?.groups?.["newStart"] ?? 0),
  };
}
