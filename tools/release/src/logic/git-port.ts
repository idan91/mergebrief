import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { Mutable, Result } from "types/utils";

import {
  DEFAULT_BRANCH,
  DEFAULT_BRANCH_REF,
  GIT_REMOTE,
  PUBLIC_BRANCH_REF,
  PUBLIC_RECORD_TAG_PREFIX,
  PUBLISH_TOKEN_ENV,
} from "../consts";
import type {
  AnnotatedTagInputs,
  BundleRef,
  GitIdentity,
  GitPort,
  PublicRecord,
  PublicRefs,
  ReleaseCommitInputs,
  TreeChangeCounts,
} from "../types";
import { type ChildEnv, stripCredentialVariables } from "./credential-env";
import { redactUrlCredentials } from "./remote-url";

const TAG_REF_PREFIX = "refs/tags/";
const PEELED_SUFFIX = "^{}";

const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

const NUL = "\0";
const TAB = "\t";

/** A git command that exited non-zero; message, `detail` and `stderr` carry no URL credentials. */
export class GitCommandError extends Error {
  readonly detail: string;
  /** All of git's stderr, credentials stripped. */
  readonly stderr: string;

  constructor(args: readonly string[], stderr: string) {
    const redacted = redactUrlCredentials(stderr.trim());
    const detail = redacted.split("\n").at(-1) ?? "";
    const command = redactUrlCredentials(args.join(" "));
    super(`git ${command}: ${detail}`);
    this.name = "GitCommandError";
    this.detail = detail;
    this.stderr = redacted;
  }
}

// What git prints when nothing public answers at a URL: GitHub's missing or
// private repository, a path that is no repository, or an anonymous read
// asked for credentials it is not allowed to prompt for.
const REPOSITORY_NOT_FOUND = [
  /repository '[^']*' not found/i,
  /does not appear to be a git repository/,
  /could not read Username/,
  /unable to get password from user/,
] as const;

export function isRepositoryNotFound(stderr: string): boolean {
  return REPOSITORY_NOT_FOUND.some((pattern) => pattern.test(stderr));
}

const UTC_OFFSET = "+0000";
const ISO_OFFSET =
  /(?<zulu>Z)|(?<sign>[+-])(?<hours>\d{2}):?(?<minutes>\d{2})$/;
const MS_PER_SECOND = 1000;

/** `<seconds since epoch> <+hhmm>`, the form a raw tag object carries. */
export function formatGitTimestamp(isoDate: string): string {
  const seconds = Math.floor(Date.parse(isoDate) / MS_PER_SECOND);
  const groups = ISO_OFFSET.exec(isoDate)?.groups;
  const offset =
    groups === undefined || groups["zulu"] !== undefined
      ? UTC_OFFSET
      : `${groups["sign"]}${groups["hours"]}${groups["minutes"]}`;
  return `${seconds} ${offset}`;
}

function parseTagRefs(listed: string): readonly string[] {
  const lines = listed.split("\n");
  const refs = lines.map((line) => line.split(TAB)[1] ?? "");
  const tags = refs
    .filter((ref) => ref.startsWith(TAG_REF_PREFIX))
    .map((ref) => ref.slice(TAG_REF_PREFIX.length));
  return tags;
}

interface RemoteRef {
  readonly sha: string;
  readonly ref: string;
}

function parseRemoteRefs(listed: string): readonly RemoteRef[] {
  const refs: RemoteRef[] = [];
  for (const line of listed.split("\n")) {
    const [sha, ref] = line.split(TAB);
    const listsRef = sha !== undefined && ref !== undefined && sha.length > 0;
    if (listsRef) {
      refs.push({ sha, ref });
    }
  }
  return refs;
}

const SCRATCH_IDENTITY = [
  "-c",
  "user.name=release scratch",
  "-c",
  "user.email=release@localhost",
  "-c",
  "commit.gpgsign=false",
] as const;

const NO_SIGNING = ["-c", "commit.gpgsign=false"] as const;

// The helper hands git the token from its own environment, so neither argv
// nor the URL ever carries it; `credential.helper=` first drops every
// configured helper.
const TOKEN_HELPER = `!f() { echo username=x-access-token; echo "password=$${PUBLISH_TOKEN_ENV}"; }; f`;
const TOKEN_HELPER_ARGS = [
  "-c",
  "credential.helper=",
  "-c",
  `credential.helper=${TOKEN_HELPER}`,
] as const;
const ANONYMOUS_ARGS = ["-c", "credential.interactive=false"] as const;
const NO_PROMPT_ENV = { GIT_TERMINAL_PROMPT: "0" } as const;

/** What execFileSync throws on a non-zero exit, as far as this port reads it. */
interface ExecError {
  readonly stderr?: string | Buffer;
}

function isExecError(cause: unknown): cause is ExecError {
  const execShaped =
    typeof cause === "object" && cause !== null && "stderr" in cause;
  return execShaped;
}

interface GitRunOptions {
  /** The whole environment of the child, never the parent's by default. */
  readonly env: ChildEnv;
  readonly input?: string;
}

function runGit(
  cwd: string,
  args: readonly string[],
  options: GitRunOptions,
): string {
  const stdin = options.input === undefined ? "ignore" : "pipe";
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: [stdin, "pipe", "pipe"],
      maxBuffer: MAX_OUTPUT_BYTES,
      input: options.input,
      env: options.env,
    });
  } catch (cause) {
    const stderr = isExecError(cause) ? String(cause.stderr ?? "") : "";
    throw new GitCommandError(args, stderr);
  }
}

/** `undefined` where git says no (exit 1); any other failure still throws. */
function tryGit(
  cwd: string,
  env: ChildEnv,
  args: readonly string[],
): string | undefined {
  try {
    return runGit(cwd, args, { env });
  } catch {
    return undefined;
  }
}

function listUrlTags(
  cwd: string,
  env: ChildEnv,
  url: string,
): readonly string[] | undefined {
  try {
    const listed = runGit(
      cwd,
      [...ANONYMOUS_ARGS, "ls-remote", "--tags", "--refs", url],
      { env: { ...env, ...NO_PROMPT_ENV } },
    );
    return parseTagRefs(listed);
  } catch (cause) {
    const notFound =
      cause instanceof GitCommandError && isRepositoryNotFound(cause.stderr);
    if (notFound) {
      return undefined;
    }
    throw cause;
  }
}

function commitEveryFile(dir: string, env: ChildEnv): void {
  runGit(dir, ["init", "--quiet", "--initial-branch=main"], { env });
  runGit(dir, ["add", "--all", "--force"], { env });
  runGit(
    dir,
    [
      ...SCRATCH_IDENTITY,
      "commit",
      "--quiet",
      "--no-verify",
      "-m",
      "export tree",
    ],
    { env },
  );
}

/** `git archive` of exactly `paths`, unpacked by tar; the tarball lives outside `dir`. */
function archivePaths(
  cwd: string,
  env: ChildEnv,
  commit: string,
  dir: string,
  paths: readonly string[],
): void {
  if (paths.length === 0) {
    throw new Error(
      "archive needs at least one path; git archive with none writes the whole commit",
    );
  }
  const scratchPrefix = join(tmpdir(), "release-archive-");
  const scratch = mkdtempSync(scratchPrefix);
  const tarball = join(scratch, "tree.tar");
  try {
    runGit(
      cwd,
      [
        "--literal-pathspecs",
        "archive",
        "--format=tar",
        `--output=${tarball}`,
        commit,
        "--",
        ...paths,
      ],
      { env },
    );
    execFileSync("tar", ["-xf", tarball], {
      cwd: dir,
      env,
      stdio: ["ignore", "ignore", "pipe"],
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/**
 * Every object publish writes goes to a temp store layered over the
 * repository's own, read through alternates, so a dry run leaves the
 * repository's object db and refs exactly as it found them.
 */
interface ScratchObjects {
  readonly ensureDir: () => string;
  readonly buildEnv: () => ChildEnv;
  readonly discard: () => void;
}

function createScratchObjects(cwd: string, baseEnv: ChildEnv): ScratchObjects {
  let dir: string | undefined;
  let objects: string | undefined;
  return {
    ensureDir() {
      const objectsPrefix = join(tmpdir(), "release-objects-");
      dir ??= mkdtempSync(objectsPrefix);
      return dir;
    },
    buildEnv() {
      objects ??= runGit(
        cwd,
        ["rev-parse", "--path-format=absolute", "--git-path", "objects"],
        { env: baseEnv },
      ).trim();
      return {
        ...baseEnv,
        GIT_OBJECT_DIRECTORY: this.ensureDir(),
        GIT_ALTERNATE_OBJECT_DIRECTORIES: objects,
      };
    },
    discard() {
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
        dir = undefined;
      }
    },
  };
}

function getTreeEntryPathOffset(entry: string): number {
  return entry.indexOf(TAB) + 1;
}

/** `ls-tree -r -z` records, `mode SP type SP sha TAB path`, keyed by path. */
function listTreeEntries(
  cwd: string,
  env: ChildEnv,
  tree: string,
): ReadonlyMap<string, string> {
  const listed = runGit(cwd, ["ls-tree", "-r", "-z", tree], { env });
  const entries = new Map<string, string>();
  for (const record of listed.split(NUL)) {
    if (record.length > 0) {
      const path = record.slice(getTreeEntryPathOffset(record));
      entries.set(path, record);
    }
  }
  return entries;
}

function writeTreeOf(
  cwd: string,
  scratch: ScratchObjects,
  commit: string,
  paths: readonly string[],
): string {
  const env = {
    ...scratch.buildEnv(),
    GIT_INDEX_FILE: join(scratch.ensureDir(), "index"),
  };
  const entries = listTreeEntries(cwd, env, commit);
  const wanted = paths
    .map((path) => entries.get(path))
    .filter((record): record is string => record !== undefined);

  const indexInfo = wanted.map((record) => `${record}${NUL}`).join("");
  runGit(cwd, ["read-tree", "--empty"], { env });
  runGit(cwd, ["update-index", "-z", "--index-info"], {
    env,
    input: indexInfo,
  });
  return runGit(cwd, ["write-tree"], { env }).trim();
}

const EXECUTABLE_BITS = 0o111;
const BLOB_MODE = "100644";
const EXECUTABLE_MODE = "100755";
const SYMLINK_MODE = "120000";

/** `mode SP sha` per path under `dir`, hashed as git would store them, filters off. */
function hashDirEntries(
  cwd: string,
  env: ChildEnv,
  dir: string,
): ReadonlyMap<string, string> {
  const files: string[] = [];
  const hashed = new Map<string, string>();
  for (const entry of readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    const full = join(entry.parentPath, entry.name);
    const path = relative(dir, full);
    if (entry.isSymbolicLink()) {
      const target = readlinkSync(full);
      const sha = runGit(cwd, ["hash-object", "--stdin"], {
        env,
        input: target,
      });
      hashed.set(path, `${SYMLINK_MODE} ${sha.trim()}`);
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  const pathList = files.map((path) => `${join(dir, path)}\n`).join("");
  const hashedList = runGit(
    cwd,
    ["hash-object", "--no-filters", "--stdin-paths"],
    { env, input: pathList },
  );
  const shas = hashedList.split("\n").filter((sha) => sha.length > 0);
  files.forEach((path, index) => {
    const executable =
      (lstatSync(join(dir, path)).mode & EXECUTABLE_BITS) !== 0;
    const mode = executable ? EXECUTABLE_MODE : BLOB_MODE;
    hashed.set(path, `${mode} ${shas[index] ?? ""}`);
  });
  return hashed;
}

function compareTreeToDir(
  cwd: string,
  env: ChildEnv,
  tree: string,
  dir: string,
): readonly string[] {
  const expected = new Map<string, string>();
  for (const [path, record] of listTreeEntries(cwd, env, tree)) {
    const [mode, , sha] = record.split(" ");
    const objectSha = sha?.slice(0, sha.indexOf(TAB));
    expected.set(path, `${mode} ${objectSha}`);
  }
  const actual = hashDirEntries(cwd, env, dir);

  const paths = new Set([...expected.keys(), ...actual.keys()]);
  const differing = [...paths]
    .filter((path) => expected.get(path) !== actual.get(path))
    .toSorted();
  return differing;
}

function buildIdentityEnv(
  role: "AUTHOR" | "COMMITTER",
  who: GitIdentity,
  date: string,
): ChildEnv {
  return {
    [`GIT_${role}_NAME`]: who.name,
    [`GIT_${role}_EMAIL`]: who.email,
    [`GIT_${role}_DATE`]: date,
  };
}

function commitTreeWith(
  cwd: string,
  scratch: ScratchObjects,
  inputs: ReleaseCommitInputs,
): string {
  const args = [...NO_SIGNING, "commit-tree", inputs.treeSha];
  if (inputs.parent !== undefined) {
    args.push("-p", inputs.parent);
  }
  const env = {
    ...scratch.buildEnv(),
    ...buildIdentityEnv("AUTHOR", inputs.author, inputs.date),
    ...buildIdentityEnv("COMMITTER", inputs.committer, inputs.date),
  };
  return runGit(cwd, args, { env, input: inputs.message }).trim();
}

function formatTagObject(inputs: AnnotatedTagInputs): string {
  const tagger = `${inputs.tagger.name} <${inputs.tagger.email}> ${formatGitTimestamp(inputs.date)}`;
  const message = inputs.message.endsWith("\n")
    ? inputs.message
    : `${inputs.message}\n`;
  return `object ${inputs.target}\ntype commit\ntag ${inputs.name}\ntagger ${tagger}\n\n${message}`;
}

const CHANGE_ADDED = "A";
const CHANGE_DELETED = "D";

function countChanges(
  cwd: string,
  env: ChildEnv,
  parent: string | undefined,
  commit: string,
): TreeChangeCounts {
  const range = parent === undefined ? ["--root", commit] : [parent, commit];
  const listed = runGit(
    cwd,
    ["diff-tree", "-r", "-z", "--no-commit-id", "--name-status", ...range],
    { env },
  );
  const tokens = listed.split(NUL);
  let added = 0;
  let edited = 0;
  let deleted = 0;
  for (let index = 0; index + 1 < tokens.length; index += 2) {
    const status = tokens[index]?.charAt(0);
    if (status === CHANGE_ADDED) {
      added += 1;
    } else if (status === CHANGE_DELETED) {
      deleted += 1;
    } else {
      edited += 1;
    }
  }
  return { added, edited, deleted };
}

function readPublicRefs(listed: string): PublicRefs {
  const tags = new Map<string, string>();
  let main: string | undefined;
  for (const { sha, ref } of parseRemoteRefs(listed)) {
    if (ref === PUBLIC_BRANCH_REF) {
      main = sha;
      continue;
    }
    const peeled = ref.endsWith(PEELED_SUFFIX);
    const name = ref.slice(
      TAG_REF_PREFIX.length,
      peeled ? -PEELED_SUFFIX.length : undefined,
    );
    const lightweightOrPeeled = peeled || !tags.has(name);
    if (lightweightOrPeeled) {
      tags.set(name, sha);
    }
  }
  const refs: Mutable<PublicRefs> = { tags };
  if (main !== undefined) {
    refs.main = main;
  }
  return refs;
}

/** Reads anonymously: the public repository is public, and only a push ever carries the token. */
function fetchPublicRefs(
  cwd: string,
  scratch: ScratchObjects,
  url: string,
): PublicRefs | undefined {
  const env = { ...scratch.buildEnv(), ...NO_PROMPT_ENV };
  let listed: string;
  try {
    listed = runGit(
      cwd,
      [
        ...ANONYMOUS_ARGS,
        "ls-remote",
        url,
        PUBLIC_BRANCH_REF,
        `${TAG_REF_PREFIX}v*`,
      ],
      { env },
    );
  } catch (cause) {
    const notFound =
      cause instanceof GitCommandError && isRepositoryNotFound(cause.stderr);
    if (notFound) {
      return undefined;
    }
    throw cause;
  }

  const refs = readPublicRefs(listed);
  if (refs.main !== undefined) {
    runGit(
      cwd,
      [
        ...ANONYMOUS_ARGS,
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-write-fetch-head",
        url,
        PUBLIC_BRANCH_REF,
      ],
      { env },
    );
  }
  return refs;
}

const RECORD_REF_PREFIX = `${TAG_REF_PREFIX}${PUBLIC_RECORD_TAG_PREFIX}`;
const RECORD_MESSAGE = /^public-commit (?<commit>[0-9a-f]{40})$/m;

function readRecord(
  cwd: string,
  env: ChildEnv,
  ref: string,
  tagObject: string,
  source: string,
): PublicRecord | undefined {
  const text = runGit(cwd, ["cat-file", "-p", tagObject], { env });
  const commit = RECORD_MESSAGE.exec(text)?.groups?.["commit"];
  if (commit === undefined) {
    return undefined;
  }
  return {
    version: ref.slice(RECORD_REF_PREFIX.length),
    source,
    publicCommit: commit,
  };
}

function listRecordsOf(
  cwd: string,
  scratch: ScratchObjects,
  privateRemote: string,
): Result<readonly PublicRecord[], string> {
  const env = scratch.buildEnv();
  const listed = runGit(
    cwd,
    ["ls-remote", privateRemote, `${RECORD_REF_PREFIX}*`],
    { env },
  );
  const refs = parseRemoteRefs(listed);
  const tagObjects = refs.filter(({ ref }) => !ref.endsWith(PEELED_SUFFIX));
  if (tagObjects.length === 0) {
    return { ok: true, value: [] };
  }

  runGit(
    cwd,
    [
      "fetch",
      "--quiet",
      "--no-tags",
      "--no-write-fetch-head",
      privateRemote,
      ...tagObjects.map(({ ref }) => ref),
    ],
    { env },
  );
  const records: PublicRecord[] = [];
  for (const { sha, ref } of tagObjects) {
    const source = refs.find(
      (peeled) => peeled.ref === `${ref}${PEELED_SUFFIX}`,
    )?.sha;
    if (source === undefined) {
      const error = `${ref} is not an annotated tag; fix the tag by hand`;
      return { ok: false, error };
    }
    const record = readRecord(cwd, env, ref, sha, source);
    if (record === undefined) {
      const error = `${ref} is not a release record; fix the tag by hand`;
      return { ok: false, error };
    }
    records.push(record);
  }
  return { ok: true, value: records };
}

/** A bundle of `refs` that leaves out everything `excluding` reaches, written from a throwaway bare repository so no ref lands here. */
function bundleRefs(
  scratch: ScratchObjects,
  file: string,
  refs: readonly BundleRef[],
  excluding: string,
): void {
  const repoPrefix = join(tmpdir(), "release-bundle-");
  const repo = mkdtempSync(repoPrefix);
  const env = scratch.buildEnv();
  try {
    runGit(repo, ["init", "--bare", "--quiet"], { env });
    for (const { ref, sha } of refs) {
      runGit(repo, ["update-ref", ref, sha], { env });
    }
    runGit(
      repo,
      [
        "bundle",
        "create",
        "--quiet",
        file,
        ...refs.map(({ ref }) => ref),
        `^${excluding}`,
      ],
      { env },
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

export interface GitPortOptions {
  /** The parent's environment; every child gets it with credential-shaped variables removed. */
  readonly env: ChildEnv;
  /** Where main and the records are read and the record pushed; `origin` unless a credential-free clone stands in. */
  readonly privateRemote?: string | undefined;
}

/** The real git under `cwd`; tags are read from the remote, never from local refs alone. */
export function createGitPort(cwd: string, options: GitPortOptions): GitPort {
  const env = stripCredentialVariables(options.env);
  const privateRemote = options.privateRemote ?? GIT_REMOTE;
  const scratch = createScratchObjects(cwd, env);
  return {
    fetchDefaultBranch() {
      const refspec = `+refs/heads/${DEFAULT_BRANCH}:${DEFAULT_BRANCH_REF}`;
      runGit(cwd, ["fetch", "--quiet", "--no-tags", privateRemote, refspec], {
        env,
      });
    },
    listPublicTags(url) {
      return listUrlTags(cwd, env, url);
    },
    commitScratchRepo(dir) {
      commitEveryFile(dir, env);
    },
    resolveCommit(ref) {
      const resolved = tryGit(cwd, env, [
        "rev-parse",
        "--verify",
        "--quiet",
        `${ref}^{commit}`,
      ]);
      return resolved?.trim();
    },
    isOnDefaultBranch(commit) {
      const onBranch = tryGit(cwd, env, [
        "merge-base",
        "--is-ancestor",
        commit,
        DEFAULT_BRANCH_REF,
      ]);
      return onBranch !== undefined;
    },
    isAncestor(ancestor, descendant) {
      const contained = tryGit(cwd, env, [
        "merge-base",
        "--is-ancestor",
        ancestor,
        descendant,
      ]);
      return contained !== undefined;
    },
    listTrackedPaths(commit) {
      const listed = runGit(
        cwd,
        ["ls-tree", "-r", "-z", "--name-only", commit],
        { env },
      );
      const paths = listed.split(NUL).filter((path) => path.length > 0);
      return paths;
    },
    archiveTo(commit, dir, paths) {
      archivePaths(cwd, env, commit, dir, paths);
    },
    readCommitterDate(commit) {
      return runGit(cwd, ["show", "-s", "--format=%cI", commit], {
        env,
      }).trim();
    },
    listCoAuthorTrailers(fromExclusive, to) {
      const range =
        fromExclusive === undefined ? to : `${fromExclusive}..${to}`;
      const listed = runGit(
        cwd,
        [
          "log",
          "--format=%(trailers:key=Co-authored-by,valueonly,unfold)",
          range,
        ],
        { env },
      );
      const lines = listed.split("\n");
      const values = lines
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      return values;
    },
    writeTree(commit, paths) {
      return writeTreeOf(cwd, scratch, commit, paths);
    },
    verifyTreeMatchesDir(tree, dir) {
      return compareTreeToDir(cwd, scratch.buildEnv(), tree, dir);
    },
    commitTree(inputs) {
      return commitTreeWith(cwd, scratch, inputs);
    },
    hasObject(sha) {
      try {
        runGit(cwd, ["cat-file", "-e", sha], { env: scratch.buildEnv() });
        return true;
      } catch {
        return false;
      }
    },
    writeAnnotatedTag(inputs) {
      const tag = runGit(cwd, ["mktag"], {
        env: scratch.buildEnv(),
        input: formatTagObject(inputs),
      });
      return tag.trim();
    },
    countTreeChanges(parent, commit) {
      return countChanges(cwd, scratch.buildEnv(), parent, commit);
    },
    fetchPublic(url) {
      return fetchPublicRefs(cwd, scratch, url);
    },
    pushPublic(url, token, refspecs) {
      runGit(
        cwd,
        [...TOKEN_HELPER_ARGS, "push", "--no-follow-tags", url, ...refspecs],
        {
          env: {
            ...scratch.buildEnv(),
            ...NO_PROMPT_ENV,
            [PUBLISH_TOKEN_ENV]: token,
          },
        },
      );
    },
    listRecords() {
      return listRecordsOf(cwd, scratch, privateRemote);
    },
    pushRecord(version, tagObject) {
      const refspec = `${tagObject}:${RECORD_REF_PREFIX}${version}`;
      runGit(cwd, ["push", "--no-follow-tags", privateRemote, refspec], {
        env: scratch.buildEnv(),
      });
    },
    writeBundle(file, refs, excluding) {
      bundleRefs(scratch, file, refs, excluding);
    },
    discardScratchObjects() {
      scratch.discard();
    },
  };
}
