import { existsSync } from "node:fs";
import { basename, extname } from "node:path";
import type { Result } from "types/utils";

import type { CommandRunner } from "../types";
import type { RepoSlug } from "./github";

const TICKET = /^[A-Za-z]+-\d+$/;
const MEDIA_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".mp4",
  ".mov",
]);
const BLOB_MODE = "100644";
const TREE_MODE = "040000";

export interface AssetsDeps {
  readonly git: CommandRunner;
  readonly gh: CommandRunner;
  readonly slug: RepoSlug;
}

interface TreeEntry {
  readonly mode: string;
  readonly type: string;
  readonly sha: string;
  readonly name: string;
}

function runGit(
  git: CommandRunner,
  args: readonly string[],
  input?: string,
): Result<string, Error> {
  const run = input === undefined ? git(args) : git(args, input);
  if (run.status !== 0) {
    return {
      ok: false,
      error: new Error(`git ${args[0] ?? ""} failed: ${run.stderr.trim()}`),
    };
  }
  return { ok: true, value: run.stdout.trim() };
}

function parseTree(listing: string): Map<string, TreeEntry> {
  const entries = new Map<string, TreeEntry>();
  for (const line of listing.split("\n")) {
    const match = /^(\d+) (\w+) ([0-9a-f]+)\t(.+)$/.exec(line);
    const [, mode, type, sha, name] = match ?? [];
    if (
      mode !== undefined &&
      type !== undefined &&
      sha !== undefined &&
      name !== undefined
    ) {
      entries.set(name, { mode, type, sha, name });
    }
  }
  return entries;
}

function writeTree(
  git: CommandRunner,
  entries: Map<string, TreeEntry>,
): Result<string, Error> {
  const listing = [...entries.values()]
    .map((entry) => `${entry.mode} ${entry.type} ${entry.sha}\t${entry.name}`)
    .join("\n");
  return runGit(git, ["mktree"], `${listing}\n`);
}

function validate(
  ticket: string,
  files: readonly string[],
): Result<void, Error> {
  if (!TICKET.test(ticket)) {
    return {
      ok: false,
      error: new Error(`ticket "${ticket}" is not KEY-number, e.g. BRIEF-476`),
    };
  }
  if (files.length === 0) {
    return { ok: false, error: new Error("no files given") };
  }
  for (const file of files) {
    if (!MEDIA_EXTENSIONS.has(extname(file).toLowerCase())) {
      return {
        ok: false,
        error: new Error(`${file} is not an image or video`),
      };
    }
    if (!existsSync(file)) {
      return { ok: false, error: new Error(`${file} does not exist`) };
    }
  }
  return { ok: true, value: undefined };
}

/** The tip of the remote assets branch, or undefined when it does not exist yet. */
function readRemoteTip(
  git: CommandRunner,
  ref: string,
): Result<string | undefined, Error> {
  const listed = runGit(git, ["ls-remote", "--end-of-options", "origin", ref]);
  if (!listed.ok) {
    return listed;
  }
  const sha = listed.value.split("\t")[0];
  if (sha === undefined || sha === "") {
    return { ok: true, value: undefined };
  }
  const fetched = runGit(git, [
    "fetch",
    "-q",
    "--end-of-options",
    "origin",
    ref,
  ]);
  return fetched.ok ? { ok: true, value: sha } : fetched;
}

function buildLink(
  slug: RepoSlug,
  isPrivate: boolean,
  commit: string,
  path: string,
): string {
  if (isPrivate) {
    return `https://github.com/${slug.owner}/${slug.name}/blob/${commit}/${path}?raw=true`;
  }
  return `https://raw.githubusercontent.com/${slug.owner}/${slug.name}/${commit}/${path}`;
}

/**
 * Commits the files under `<ticket>/` on `assets/<ticket>` with plumbing only, so
 * the working tree and index are never touched, and pushes with a lease on the tip
 * it read. Links pin the commit, so a later push never repoints an earlier link.
 */
export function runAssets(
  deps: AssetsDeps,
  ticket: string,
  files: readonly string[],
): Result<string, Error> {
  const valid = validate(ticket, files);
  if (!valid.ok) {
    return valid;
  }
  const { git } = deps;
  const folder = ticket.toLowerCase();
  const ref = `refs/heads/assets/${folder}`;

  const tip = readRemoteTip(git, ref);
  if (!tip.ok) {
    return tip;
  }
  const rootListing =
    tip.value === undefined ? undefined : runGit(git, ["ls-tree", tip.value]);
  if (rootListing !== undefined && !rootListing.ok) {
    return rootListing;
  }
  const root = parseTree(rootListing?.value ?? "");
  const existingFolder = root.get(folder);
  const folderListing =
    existingFolder === undefined
      ? undefined
      : runGit(git, ["ls-tree", existingFolder.sha]);
  if (folderListing !== undefined && !folderListing.ok) {
    return folderListing;
  }
  const folderEntries = parseTree(folderListing?.value ?? "");

  for (const file of files) {
    const blob = runGit(git, ["hash-object", "-w", "--", file]);
    if (!blob.ok) {
      return blob;
    }
    const name = basename(file);
    folderEntries.set(name, {
      mode: BLOB_MODE,
      type: "blob",
      sha: blob.value,
      name,
    });
  }
  const folderTree = writeTree(git, folderEntries);
  if (!folderTree.ok) {
    return folderTree;
  }
  root.set(folder, {
    mode: TREE_MODE,
    type: "tree",
    sha: folderTree.value,
    name: folder,
  });
  const rootTree = writeTree(git, root);
  if (!rootTree.ok) {
    return rootTree;
  }

  const parent = tip.value === undefined ? [] : ["-p", tip.value];
  const message = `assets: ${files.map((file) => basename(file)).join(", ")}`;
  const commit = runGit(git, [
    "commit-tree",
    rootTree.value,
    ...parent,
    "-m",
    message,
  ]);
  if (!commit.ok) {
    return commit;
  }
  const pushed = runGit(git, [
    "push",
    "-q",
    `--force-with-lease=${ref}:${tip.value ?? ""}`,
    "origin",
    `${commit.value}:${ref}`,
  ]);
  if (!pushed.ok) {
    return pushed;
  }

  const visibility = deps.gh([
    "api",
    `repos/${deps.slug.owner}/${deps.slug.name}`,
    "--jq",
    ".private",
  ]);
  const isPrivate = visibility.stdout.trim() !== "false";
  const links = files.map((file) => {
    const name = basename(file);
    const label = name.slice(0, name.length - extname(name).length);
    return `![${label}](${buildLink(deps.slug, isPrivate, commit.value, `${folder}/${name}`)})`;
  });
  return { ok: true, value: links.join("\n") };
}
