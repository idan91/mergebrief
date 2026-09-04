import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** Folder-internal exec plumbing shared by the gh readers; not on the barrel. */
export const execFileAsync = promisify(execFile);

/** 64 MiB — large PRs can produce big diffs; default execFile buffer is 1 MiB. */
export const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * GitHub owner/repo segment grammar: alphanumerics, hyphen, underscore, dot.
 * Validating before we ever hand a value to `gh` keeps untrusted URL input
 * out of the argument list (defense in depth — we use execFile, not a shell,
 * so there is no shell to inject into either way).
 */
export const SEGMENT = /^[A-Za-z0-9._-]+$/;
