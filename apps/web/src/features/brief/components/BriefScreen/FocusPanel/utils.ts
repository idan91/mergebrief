import type { AttributeDisplayMeta } from "../../../utils/repoConfig";
import type { FilePathDirectory, FilePathParts } from "./types";

/** Each directory keeps its trailing slash, so a break can follow it. */
export function splitFilePath(path: string): FilePathParts {
  const cut = path.lastIndexOf("/") + 1;
  const directories: FilePathDirectory[] = [];
  let key = "";

  for (const part of path.slice(0, cut).split("/").slice(0, -1)) {
    key += `${part}/`;
    directories.push({ key, text: `${part}/` });
  }
  return { directories, basename: path.slice(cut) };
}

/** Repo-policy and de-emphasized risks carry detail behind a disclosure. */
export function isDisclosedRisk(
  meta: AttributeDisplayMeta | undefined,
): boolean {
  return meta?.source === "repo-policy" || meta?.deEmphasized === true;
}
