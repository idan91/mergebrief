import "@tanstack/react-start/server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Brief, BriefChunk, DiffLine } from "./types";
import { parseBrief } from "./validation";

const LOCAL_BRIEF_PATH = resolve(process.cwd(), "../../tools/categorizer/out/Idan91-flexer-55.brief.json");

export async function readLocalBrief(): Promise<Brief> {
  const raw = await readFile(LOCAL_BRIEF_PATH, "utf8");
  const parsedJson: unknown = JSON.parse(raw);
  const parsedBrief = parseBrief(parsedJson);
  if (!parsedBrief.ok) {
    throw new Error(`Invalid local brief: ${parsedBrief.error}`);
  }
  return attachFileDiffs(parsedBrief.value);
}

async function attachFileDiffs(brief: Brief): Promise<Brief> {
  const fileDiffs = await fetchFileDiffs(brief.pr.url);
  if (fileDiffs.size === 0) return brief;

  return {
    ...brief,
    chunks: brief.chunks.map((chunk) => {
      const diff = fileDiffs.get(chunk.file);
      return diff ? ({ ...chunk, diff } satisfies BriefChunk) : chunk;
    }),
  };
}

async function fetchFileDiffs(prUrl: string): Promise<Map<string, DiffLine[]>> {
  try {
    const response = await fetch(`${prUrl}.diff`, {
      headers: { Accept: "text/plain" },
    });
    if (!response.ok) return new Map();
    return parseUnifiedDiff(await response.text());
  } catch {
    return new Map();
  }
}

function parseUnifiedDiff(diffText: string): Map<string, DiffLine[]> {
  const files = new Map<string, DiffLine[]>();
  let currentFile: string | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      currentFile = parseDiffFilePath(line);
      if (currentFile) files.set(currentFile, []);
      oldLine = 0;
      newLine = 0;
      continue;
    }
    if (!currentFile) continue;
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ") || line.startsWith("new file mode ") || line.startsWith("deleted file mode ")) {
      continue;
    }

    const rows = files.get(currentFile);
    if (!rows) continue;

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

  return files;
}

function parseDiffFilePath(line: string): string | null {
  const parts = line.split(" ");
  const bPath = parts[3];
  const aPath = parts[2];
  const rawPath = bPath && bPath !== "b/dev/null" ? bPath : aPath;
  if (!rawPath) return null;
  return rawPath.replace(/^[ab]\//, "");
}

function parseHunkLine(line: string): { oldStart: number; newStart: number } {
  const match = /^@@ -(?<oldStart>\d+)(?:,\d+)? \+(?<newStart>\d+)(?:,\d+)? @@/.exec(line);
  return {
    oldStart: Number(match?.groups?.["oldStart"] ?? 0),
    newStart: Number(match?.groups?.["newStart"] ?? 0),
  };
}
