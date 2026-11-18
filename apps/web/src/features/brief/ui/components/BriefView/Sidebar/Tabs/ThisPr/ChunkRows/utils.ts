/** Marks the folders cut above a row's parent folder. */
const CUT_FOLDERS_MARK = "…/";

/** A Sidebar sheet row's path: the file's own folder, then its name. */
export interface ChunkRowPath {
  /** Absent for a file at the repository root. */
  folder?: string;
  fileName: string;
}

/** Keeps the parent folder so two same-named files in one group stay apart. */
export function deriveChunkRowPath(path: string): ChunkRowPath {
  const segments = path.split("/");
  const fileName = segments.pop() ?? path;
  const parent = segments.pop();
  if (parent === undefined) {
    return { fileName };
  }

  const cutMark = segments.length > 0 ? CUT_FOLDERS_MARK : "";
  return { folder: `${cutMark}${parent}/`, fileName };
}
