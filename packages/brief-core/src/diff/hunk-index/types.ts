import type { ValueOf } from "types/utils";

export const DiffFileStatuses = {
  ADDED: "added",
  DELETED: "deleted",
  RENAMED: "renamed",
  MODIFIED: "modified",
} as const;
export type DiffFileStatus = ValueOf<typeof DiffFileStatuses>;

export type FileId = `f${number}`;
export type HunkId = `${FileId}h${number}`;

export interface IndexedHunk {
  id: HunkId;
  /** Absent on the one placeholder hunk of a file with no text hunk (binary, pure rename, mode change). */
  header?: string;
  lines: string[];
  added: number;
  removed: number;
}

export interface IndexedFile {
  id: FileId;
  path: string;
  previousPath?: string;
  status: DiffFileStatus;
  binary: boolean;
  /** The patch lines before the first hunk header. */
  headerLines: string[];
  hunks: IndexedHunk[];
  added: number;
  removed: number;
}
