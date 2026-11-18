import type { SplitPath } from "./types";

/** The directory keeps its trailing slash; a bare file name has none. */
export function splitDirectoryAndFileName(path: string): SplitPath {
  const lastSlash = path.lastIndexOf("/");
  return {
    directory: path.slice(0, lastSlash + 1),
    fileName: path.slice(lastSlash + 1),
  };
}
