import type { Disposition } from "@web/features/review/session";
import type { BriefChunk } from "../../../../../../types";
import type { RiskFlag } from "../../../../../../utils/viewModel";

export interface FileFlagRow {
  file: string;
  flags: RiskFlag[];
  openFlags: RiskFlag[];
  resolvedFlags: RiskFlag[];
}

export function getFlagDispositionKind(
  dispositions: Record<string, Disposition | undefined>,
  flagId: string,
): Disposition["kind"] {
  return dispositions[flagId]?.kind ?? "open";
}

export function groupFlagsByFile(
  flags: readonly RiskFlag[],
  dispositions: Record<string, Disposition | undefined>,
  fileOrder: readonly string[],
): FileFlagRow[] {
  const byFile = new Map<string, RiskFlag[]>();
  for (const flag of flags) {
    const existing = byFile.get(flag.file);
    if (existing) existing.push(flag);
    else byFile.set(flag.file, [flag]);
  }

  const seen = new Set<string>();
  const rows: FileFlagRow[] = [];
  for (const file of fileOrder) {
    if (seen.has(file)) continue;
    seen.add(file);
    const fileFlags = byFile.get(file);
    if (fileFlags === undefined) continue;
    const openFlags = fileFlags.filter(
      (flag) => getFlagDispositionKind(dispositions, flag.id) === "open",
    );
    const resolvedFlags = fileFlags.filter(
      (flag) => getFlagDispositionKind(dispositions, flag.id) !== "open",
    );
    rows.push({
      file,
      flags: fileFlags,
      openFlags,
      resolvedFlags,
    });
  }
  return rows;
}

export function pickPathJumpChunkId(row: FileFlagRow): string {
  const target = row.openFlags[0] ?? row.flags[0];
  if (target === undefined) {
    throw new Error("file row has no flags");
  }
  return target.chunkId;
}

export function capitalizeSentence(text: string): string {
  const first = text[0];
  if (first === undefined) return text;
  return `${first.toLocaleUpperCase()}${text.slice(1)}`;
}

export function getChunkFile(
  chunks: readonly BriefChunk[],
  chunkId: string | null,
): string | undefined {
  return chunks.find((chunk) => chunk.id === chunkId)?.file;
}
