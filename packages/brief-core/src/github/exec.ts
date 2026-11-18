import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Folder-internal exec plumbing shared by the gh readers; not on the barrel. */
export const execFileAsync = promisify(execFile);

/** 64 MiB: large PRs can produce big diffs; default execFile buffer is 1 MiB. */
export const MAX_BUFFER = 64 * 1024 * 1024;
