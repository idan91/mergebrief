import { DiffLineKinds } from "types/diff-lines";
import { HUNK_HEADER } from "../consts";
import { FileStatuses, type FileStatus, type ParsedDiffLine } from "../types";

/**
 * A new file's hunk starts at `-0,0`, a deleted file's at `+0,0`; every
 * chunk of a file keeps its hunk header, so each reads the same answer.
 * A rename is not derivable: the slicer drops the diff's file header.
 */
export function resolveFileStatus(
  rows: readonly Pick<ParsedDiffLine, "kind" | "content">[],
): FileStatus | undefined {
  const header = rows.find((row) => row.kind === DiffLineKinds.HUNK);
  const groups = header && HUNK_HEADER.exec(header.content)?.groups;
  if (!groups) {
    return undefined;
  }
  const oldStart = Number(groups["oldStart"]);
  const oldCount = Number(groups["oldCount"] ?? "1");
  const newStart = Number(groups["newStart"]);
  const newCount = Number(groups["newCount"] ?? "1");

  if (oldStart === 0 && oldCount === 0) {
    return FileStatuses.NEW;
  }
  if (newStart === 0 && newCount === 0) {
    return FileStatuses.DELETED;
  }
  return undefined;
}
