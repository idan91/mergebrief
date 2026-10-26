import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runExport } from "../../src/logic/export";
import type { ExportOutcome } from "../../src/logic/export/types";
import { createGitPort, GitCommandError } from "../../src/logic/git-port";
import type { GitPort } from "../../src/types";
import {
  makeGitRepos,
  makeNotesFile,
  readGitOutput,
  runGit,
  stubCommandRunner,
  type Tree,
} from "../helpers";

const made: string[] = [];

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const TOKEN = "ghs_sekrit";

const FIRST: Tree = {
  "README.md": "Read [the guide](docs/guide.md).\n",
  "docs/guide.md": "Plain.\n",
  "docs/releases/0.1.0-rc.1.md": makeNotesFile({}, "Candidate.\n"),
  "docs/releases/0.1.0.md": makeNotesFile({}, "First.\n"),
  "docs/internal/adr.md": "private\n",
};

interface Lab {
  readonly root: string;
  readonly clone: string;
  readonly origin: string;
  readonly bare: string;
  readonly git: GitPort;
}

/** A private clone and origin, an empty bare public remote, and the real port over the clone. */
function makeLab(tree: Tree = FIRST): Lab {
  const repos = makeGitRepos(tree);
  made.push(repos.root);
  const bare = join(repos.root, "public.git");
  runGit(repos.root, [
    "init",
    "--bare",
    "--quiet",
    "--initial-branch=main",
    bare,
  ]);
  return {
    root: repos.root,
    clone: repos.clone,
    origin: join(repos.root, "remote.git"),
    bare,
    git: createGitPort(repos.clone, process.env),
  };
}

/** Commits `tree` on main and pushes it; `committerDate` pins the commit's date. */
function commitAndPush(
  clone: string,
  tree: Tree,
  message: string,
  committerDate?: string,
): string {
  for (const [path, content] of Object.entries(tree)) {
    mkdirSync(join(clone, path, ".."), { recursive: true });
    writeFileSync(join(clone, path), content);
  }
  runGit(clone, ["add", "--all"]);
  const env = { ...process.env };
  if (committerDate !== undefined) {
    env["GIT_COMMITTER_DATE"] = committerDate;
  }
  execFileSync("git", ["commit", "--quiet", "-m", message], {
    cwd: clone,
    env,
  });
  runGit(clone, ["push", "--quiet", "origin", "main"]);
  return readGitOutput(clone, ["rev-parse", "HEAD"]);
}

interface RunOptions {
  readonly version?: string;
  readonly source?: string;
  readonly dryRun?: boolean;
  readonly git?: GitPort;
}

function runPublish(lab: Lab, options: RunOptions = {}) {
  const printed: string[] = [];
  const out = join(lab.root, `out-${printed.length}-${Date.now()}`);
  const result = runExport(
    {
      git: options.git ?? lab.git,
      runner: stubCommandRunner().runner,
      print: (text) => printed.push(text),
    },
    {
      version: options.version ?? "0.1.0",
      source: options.source ?? "main",
      out,
      dryRun: options.dryRun ?? false,
      publicRepository: { slug: "scratch/public", url: lab.bare },
      token: TOKEN,
    },
  );
  const outcome: ExportOutcome | undefined = result.ok
    ? result.value
    : undefined;
  return { result, outcome, printed: printed.join(""), out };
}

function readRefs(repo: string): string {
  return runGit(repo, ["for-each-ref", "--format=%(refname) %(objectname)"]);
}

function countObjects(repo: string): string {
  return runGit(repo, ["count-objects", "-v"]);
}

/** A port whose public pushes fail once a refspec matches, then behave. */
function failPushOnce(git: GitPort, pattern: RegExp): GitPort {
  let failed = false;
  return {
    ...git,
    pushPublic(url, token, refspecs) {
      const hit = !failed && refspecs.some((refspec) => pattern.test(refspec));
      if (hit) {
        failed = true;
        throw new GitCommandError(["push"], "fatal: injected\n");
      }
      git.pushPublic(url, token, refspecs);
    },
  };
}

describe("publishing releases", () => {
  it("gives two releases two public commits, the second with its changes", () => {
    const lab = makeLab();
    const first = runPublish(lab);
    rmSync(join(lab.clone, "docs", "guide.md"));
    commitAndPush(
      lab.clone,
      {
        "README.md": "Changed.\n",
        "docs/new.md": "new\n",
        "docs/releases/0.2.0.md": makeNotesFile({}, "Second.\n"),
      },
      "second release work",
    );

    const second = runPublish(lab, { version: "0.2.0" });

    expect(first.outcome?.publish?.actions).toHaveLength(3);
    expect(second.outcome?.publish?.actions).toHaveLength(3);
    expect(readGitOutput(lab.bare, ["rev-list", "--count", "main"])).toBe("2");
    const status = runGit(lab.bare, [
      "diff-tree",
      "-r",
      "--name-status",
      "main^",
      "main",
    ]);
    expect(status).toContain("A\tdocs/new.md");
    expect(status).toContain("M\tREADME.md");
    expect(status).toContain("D\tdocs/guide.md");
    expect(readGitOutput(lab.bare, ["rev-parse", "v0.2.0^{commit}"])).toBe(
      readGitOutput(lab.bare, ["rev-parse", "main"]),
    );
    const recordTags = readGitOutput(lab.origin, ["tag", "--list"]);
    expect(recordTags.split("\n")).toEqual(["public/v0.1.0", "public/v0.2.0"]);
    expect(
      readGitOutput(lab.bare, ["log", "-1", "--format=%an <%ae> %cI", "main"]),
    ).toBe(
      `Idan Ram <44946814+Idan91@users.noreply.github.com> ${lab.git.readCommitterDate("HEAD")}`,
    );
  });

  it("credits contributors since the previous release in the commit body", () => {
    const lab = makeLab();
    runPublish(lab);
    commitAndPush(
      lab.clone,
      { "docs/releases/0.2.0.md": makeNotesFile({}, "Second.\n") },
      "contribution\n\nCo-authored-by: Ann Example <ann@example.org>\nCo-authored-by: Idan Ram <44946814+Idan91@users.noreply.github.com>",
    );

    runPublish(lab, { version: "0.2.0" });

    expect(runGit(lab.bare, ["cat-file", "commit", "main"])).toMatch(
      /\n\nRelease 0\.2\.0\n\nCo-authored-by: Ann Example <ann@example\.org>\n$/,
    );
    expect(runGit(lab.bare, ["cat-file", "commit", "main^"])).toMatch(
      /\n\nRelease 0\.1\.0\n$/,
    );
  });

  it("pushes nothing on a rerun and reports the same commit", () => {
    const lab = makeLab();
    const first = runPublish(lab);

    const again = runPublish(lab);

    expect(again.outcome?.publish?.commit).toBe(first.outcome?.publish?.commit);
    expect(again.outcome?.publish?.actions).toEqual([]);
    expect(again.printed).toContain("nothing to push");
  });

  it("leaves every remote and the private repository untouched on a dry run", () => {
    const lab = makeLab();
    const before = {
      origin: readRefs(lab.origin),
      bare: readRefs(lab.bare),
      clone: readRefs(lab.clone),
      objects: countObjects(lab.clone),
    };

    const { outcome, printed } = runPublish(lab, { dryRun: true });

    expect(outcome?.publish?.actions).toHaveLength(3);
    expect(printed).toContain("publish 0.1.0 (dry run)");
    expect(readRefs(lab.origin)).toBe(before.origin);
    expect(readRefs(lab.bare)).toBe(before.bare);
    expect(readRefs(lab.clone)).toBe(before.clone);
    expect(countObjects(lab.clone)).toBe(before.objects);
  });

  it("plans against an empty repository when none answers in a dry run", () => {
    const lab = makeLab();
    rmSync(lab.bare, { recursive: true, force: true });

    const { outcome, printed } = runPublish(lab, { dryRun: true });

    expect(outcome?.publish?.actions).toHaveLength(3);
    expect(printed).toContain("public repo scratch/public not found");
  });

  it("resumes after a failed tag push with one commit and no duplicate", () => {
    const lab = makeLab();
    const failing = (): void => {
      runPublish(lab, { git: failPushOnce(lab.git, /refs\/tags\//) });
    };
    expect(failing).toThrow(/injected/);

    const retry = runPublish(lab);

    expect(retry.outcome?.publish?.actions).toEqual([
      "push-tag",
      "push-record",
    ]);
    expect(readGitOutput(lab.bare, ["rev-list", "--count", "main"])).toBe("1");
    expect(readGitOutput(lab.bare, ["rev-parse", "v0.1.0^{commit}"])).toBe(
      readGitOutput(lab.bare, ["rev-parse", "main"]),
    );
    expect(readGitOutput(lab.origin, ["tag", "--list"])).toBe("public/v0.1.0");
  });

  it("resumes after a failed record push without moving anything public", () => {
    const lab = makeLab();
    const git: GitPort = {
      ...lab.git,
      pushRecord: () => {
        throw new GitCommandError(["push"], "fatal: injected\n");
      },
    };
    const failing = (): void => {
      runPublish(lab, { git });
    };
    expect(failing).toThrow(/injected/);
    const publicRefs = readRefs(lab.bare);

    const retry = runPublish(lab);

    expect(retry.outcome?.publish?.actions).toEqual(["push-record"]);
    expect(readRefs(lab.bare)).toBe(publicRefs);
    expect(readGitOutput(lab.origin, ["tag", "--list"])).toBe("public/v0.1.0");
  });

  it("refuses an existing public tag at another commit and pushes nothing", () => {
    const lab = makeLab();
    runGit(lab.clone, ["push", "--quiet", lab.bare, "HEAD:refs/tags/v0.1.0"]);
    const before = readRefs(lab.bare);

    const { result } = runPublish(lab);

    expect(!result.ok && result.error.reason).toMatch(
      /^tag v0\.1\.0 exists at [0-9a-f]{7}; tags never move$/,
    );
    expect(readRefs(lab.bare)).toBe(before);
    expect(runGit(lab.origin, ["tag", "--list"])).toBe("");
  });

  it("gives a stable after its candidate the same tree under a new commit", () => {
    const lab = makeLab();
    runPublish(lab, { version: "0.1.0-rc.1" });

    runPublish(lab, { version: "0.1.0" });

    expect(readGitOutput(lab.bare, ["rev-list", "--count", "main"])).toBe("2");
    expect(runGit(lab.bare, ["diff-tree", "-r", "main^", "main"])).toBe("");
    expect(readGitOutput(lab.bare, ["rev-parse", "v0.1.0-rc.1^{commit}"])).toBe(
      readGitOutput(lab.bare, ["rev-parse", "main^"]),
    );
  });

  it("refuses a version already exported from another source", () => {
    const lab = makeLab();
    const first = readGitOutput(lab.clone, ["rev-parse", "HEAD"]);
    runPublish(lab);
    const next = commitAndPush(lab.clone, { "docs/new.md": "new\n" }, "more");

    const { result } = runPublish(lab);

    expect(!result.ok && result.error.reason).toBe(
      `0.1.0 already exported from ${first.slice(0, 7)}; refusing ${next.slice(0, 7)}`,
    );
  });

  it("refuses a rebuilt commit that differs from the record", () => {
    const lab = makeLab();
    runPublish(lab);
    const recorded = readGitOutput(lab.bare, ["rev-parse", "main"]);
    const git: GitPort = {
      ...lab.git,
      listCoAuthorTrailers: () => ["Zed Example <zed@example.org>"],
    };

    const { result } = runPublish(lab, { git });

    expect(!result.ok && result.error.reason).toMatch(
      new RegExp(
        `^0\\.1\\.0 rebuilt as [0-9a-f]{7} differs from recorded ${recorded.slice(0, 7)}$`,
      ),
    );
  });

  it("refuses when public main is not the last release commit", () => {
    const lab = makeLab();
    runPublish(lab);
    const released = runGit(lab.bare, ["rev-parse", "main"]).trim();
    const stray = join(lab.root, "stray");
    runGit(lab.root, ["clone", "--quiet", lab.bare, stray]);
    runGit(stray, ["config", "user.email", "stray@test"]);
    runGit(stray, ["config", "user.name", "stray"]);
    writeFileSync(join(stray, "STRAY.md"), "stray\n");
    runGit(stray, ["add", "STRAY.md"]);
    runGit(stray, ["commit", "--quiet", "-m", "stray"]);
    runGit(stray, ["push", "--quiet", "origin", "main"]);
    const drifted = runGit(lab.bare, ["rev-parse", "main"]).trim();
    commitAndPush(
      lab.clone,
      { "docs/releases/0.2.0.md": makeNotesFile({}, "Second.\n") },
      "second",
    );

    const { result } = runPublish(lab, { version: "0.2.0" });

    expect(!result.ok && result.error.reason).toBe(
      `public main at ${drifted.slice(0, 7)} is not the last release commit ${released.slice(0, 7)}; reconcile first`,
    );
    expect(readGitOutput(lab.bare, ["rev-parse", "main"])).toBe(drifted);
    expect(readGitOutput(lab.origin, ["tag", "--list"])).toBe("public/v0.1.0");
  });

  it("refuses a public main that no release recorded", () => {
    const lab = makeLab();
    runGit(lab.clone, ["push", "--quiet", lab.bare, "HEAD:refs/heads/main"]);
    const head = runGit(lab.clone, ["rev-parse", "HEAD"]).trim();

    const { result } = runPublish(lab);

    expect(!result.ok && result.error.reason).toBe(
      `public main at ${head.slice(0, 7)} is not a release commit; reconcile first`,
    );
  });

  it("refuses a hand-made record tag with a message, not a crash", () => {
    const lab = makeLab();
    runGit(lab.clone, [
      "push",
      "--quiet",
      "origin",
      "HEAD:refs/tags/public/v0.0.1",
    ]);

    const { result } = runPublish(lab);

    expect(!result.ok && result.error.reason).toBe(
      "refs/tags/public/v0.0.1 is not an annotated tag; fix the tag by hand",
    );
  });

  it("stops at the notes gate when no public repository answers", () => {
    const lab = makeLab();
    rmSync(lab.bare, { recursive: true, force: true });

    const { outcome, printed } = runPublish(lab);

    expect(outcome?.gates.passed).toBe(false);
    expect(outcome?.publish).toBeUndefined();
    expect(printed).toContain(
      "public repo scratch/public not found; a publish needs it",
    );
  });
});

describe("ordering releases", () => {
  const EARLY = "2001-01-01T00:00:00Z";

  function addRelease(lab: Lab, version: string, date?: string): string {
    const notes = {
      [`docs/releases/${version}.md`]: makeNotesFile({}, "Next.\n"),
    };
    return commitAndPush(lab.clone, notes, `notes for ${version}`, date);
  }

  function readPublicCommit(lab: Lab, ref: string): string {
    return readGitOutput(lab.bare, ["rev-parse", `${ref}^{commit}`]);
  }

  it("builds on the highest version when source dates run backwards", () => {
    const lab = makeLab();
    runPublish(lab);
    addRelease(lab, "0.2.0", EARLY);
    runPublish(lab, { version: "0.2.0" });
    addRelease(lab, "0.3.0", EARLY);

    const third = runPublish(lab, { version: "0.3.0" });

    expect(third.result.ok).toBe(true);
    expect(readGitOutput(lab.bare, ["rev-list", "--count", "main"])).toBe("3");
    expect(readPublicCommit(lab, "main^")).toBe(
      readPublicCommit(lab, "v0.2.0"),
    );
  });

  it("builds on the highest version when two sources share a date", () => {
    const lab = makeLab();
    runPublish(lab);
    addRelease(lab, "0.2.0", EARLY);
    runPublish(lab, { version: "0.2.0" });
    addRelease(lab, "0.2.1", EARLY);
    runPublish(lab, { version: "0.2.1" });
    addRelease(lab, "0.3.0");

    runPublish(lab, { version: "0.3.0" });

    expect(readPublicCommit(lab, "main^")).toBe(
      readPublicCommit(lab, "v0.2.1"),
    );
  });

  it("builds a stable on its candidate and the next release on the stable", () => {
    const lab = makeLab();
    runPublish(lab, { version: "0.1.0-rc.1" });
    runPublish(lab, { version: "0.1.0" });
    addRelease(lab, "0.1.1");

    runPublish(lab, { version: "0.1.1" });

    expect(readPublicCommit(lab, "main^")).toBe(
      readPublicCommit(lab, "v0.1.0"),
    );
    expect(readPublicCommit(lab, "main^^")).toBe(
      readPublicCommit(lab, "v0.1.0-rc.1"),
    );
  });

  it("retries an earlier run with nothing to push after dates ran backwards", () => {
    const lab = makeLab();
    runPublish(lab);
    addRelease(lab, "0.2.0", EARLY);
    const first = runPublish(lab, { version: "0.2.0" });

    const retry = runPublish(lab, { version: "0.2.0" });

    expect(retry.outcome?.publish?.actions).toEqual([]);
    expect(retry.outcome?.publish?.commit).toBe(first.outcome?.publish?.commit);
  });

  it("refuses a version below the last export and pushes nothing", () => {
    const lab = makeLab();
    addRelease(lab, "0.2.0");
    runPublish(lab, { version: "0.2.0" });
    addRelease(lab, "0.1.1");
    const before = `${readRefs(lab.bare)}${readRefs(lab.origin)}`;

    const { result } = runPublish(lab, { version: "0.1.1" });

    expect(!result.ok && result.error.reason).toBe(
      "0.1.1 is not above 0.2.0, the last version exported; export a higher version",
    );
    expect(`${readRefs(lab.bare)}${readRefs(lab.origin)}`).toBe(before);
  });

  it("refuses a source older than the last export's and pushes nothing", () => {
    const notes = { "docs/releases/0.2.0.md": makeNotesFile({}, "Next.\n") };
    const lab = makeLab({ ...FIRST, ...notes });
    const older = readGitOutput(lab.clone, ["rev-parse", "HEAD"]);
    const newer = commitAndPush(lab.clone, { "docs/new.md": "new\n" }, "more");
    runPublish(lab);
    const before = `${readRefs(lab.bare)}${readRefs(lab.origin)}`;

    const { result } = runPublish(lab, { version: "0.2.0", source: older });

    expect(!result.ok && result.error.reason).toBe(
      `${older.slice(0, 7)} does not contain ${newer.slice(0, 7)}, which 0.1.0 was exported from; export a later commit on main`,
    );
    expect(`${readRefs(lab.bare)}${readRefs(lab.origin)}`).toBe(before);
  });
});

/** A port whose `git` is a wrapper on PATH logging, per call, whether the token was in its env. */
function makeLoggedPort(lab: Lab): { git: GitPort; log: string } {
  const real = execFileSync("sh", ["-c", "command -v git"], {
    encoding: "utf8",
  }).trim();
  const bin = join(lab.root, "bin");
  const log = join(lab.root, "git.log");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "git"),
    `#!/bin/sh\nprintf '%s\\t%s\\n' "\${MERGEBRIEF_PUBLISH_TOKEN:+token}" "$*" >> "${log}"\nexec "${real}" "$@"\n`,
  );
  chmodSync(join(bin, "git"), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env["PATH"] ?? ""}`,
    MERGEBRIEF_PUBLISH_TOKEN: TOKEN,
    GITHUB_TOKEN: "ghs_actions",
  };
  return { git: createGitPort(lab.clone, env), log };
}

/** One export through a port of its own, its scratch store discarded after, as each CLI run does. */
function runFresh(lab: Lab, options: RunOptions = {}) {
  const git = createGitPort(lab.clone, process.env);
  try {
    return runPublish(lab, { ...options, git });
  } finally {
    git.discardScratchObjects();
  }
}

/** A commit on public main that no release made, pushed from a clone of it; its SHA. */
function pushStrayCommit(lab: Lab, orphan = false): string {
  const stray = join(lab.root, "stray");
  runGit(lab.root, ["clone", "--quiet", lab.bare, stray]);
  runGit(stray, ["config", "user.email", "stray@test"]);
  runGit(stray, ["config", "user.name", "stray"]);
  if (orphan) {
    runGit(stray, ["switch", "--quiet", "--orphan", "unrelated"]);
  }
  writeFileSync(join(stray, "STRAY.md"), "stray\n");
  runGit(stray, ["add", "STRAY.md"]);
  runGit(stray, ["commit", "--quiet", "-m", "stray"]);
  const sha = readGitOutput(stray, ["rev-parse", "HEAD"]);
  runGit(stray, ["push", "--quiet", "origin", "HEAD:refs/heads/stray"]);
  runGit(lab.bare, ["update-ref", "refs/heads/main", sha]);
  runGit(lab.bare, ["update-ref", "-d", "refs/heads/stray"]);
  return sha;
}

function commitSecondRelease(lab: Lab): void {
  commitAndPush(
    lab.clone,
    { "docs/releases/0.2.0.md": makeNotesFile({}, "Second.\n") },
    "second",
  );
}

describe("each export in a process of its own", () => {
  it("fetches the candidate from public main to build the stable on it", () => {
    const lab = makeLab();
    const candidate = runFresh(lab, { version: "0.1.0-rc.1" });
    const objects = countObjects(lab.clone);

    const planned = runFresh(lab, { version: "0.1.0", dryRun: true });
    const stable = runFresh(lab, { version: "0.1.0" });

    const candidateCommit = candidate.outcome?.publish?.commit;
    expect(candidate.outcome?.publish?.actions).toHaveLength(3);
    expect(planned.outcome?.publish?.parent).toBe(candidateCommit);
    expect(countObjects(lab.clone)).toBe(objects);
    expect(stable.outcome?.publish?.commit).toBe(
      planned.outcome?.publish?.commit,
    );
    expect(readGitOutput(lab.bare, ["rev-parse", "main^"])).toBe(
      candidateCommit,
    );
  });

  it("hands the token to git for the public remote and nothing else", () => {
    const lab = makeLab();
    const { git, log } = makeLoggedPort(lab);

    const { outcome } = runPublish(lab, { git });

    expect(outcome?.publish?.actions).toHaveLength(3);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    const withToken = calls.filter((call) => call.startsWith("token\t"));
    expect(withToken.length).toBeGreaterThan(0);
    for (const call of withToken) {
      expect(call).toContain(lab.bare);
    }
    expect(calls.length).toBeGreaterThan(withToken.length + 10);
    expect(calls.join("\n")).not.toContain(TOKEN);
  });
  it("names the rerun release's own commit when main drifted after it", () => {
    const lab = makeLab();
    runFresh(lab);
    commitSecondRelease(lab);
    const second = runFresh(lab, { version: "0.2.0" });
    const drifted = pushStrayCommit(lab);
    const secondCommit = second.outcome?.publish?.commit ?? "";

    const { result } = runFresh(lab, { version: "0.2.0" });

    expect(!result.ok && result.error.reason).toBe(
      `public main at ${drifted.slice(0, 7)} is not the last release commit ${secondCommit.slice(0, 7)}; reconcile first`,
    );
  });

  it("refuses a deleted public main, naming the last release commit", () => {
    const lab = makeLab();
    const first = runFresh(lab);
    runGit(lab.bare, ["update-ref", "-d", "refs/heads/main"]);
    commitSecondRelease(lab);
    const firstCommit = first.outcome?.publish?.commit ?? "";
    const before = `${readRefs(lab.bare)}${readRefs(lab.origin)}`;

    const { result } = runFresh(lab, { version: "0.2.0" });

    expect(!result.ok && result.error.reason).toBe(
      `public main is missing; the last release commit is ${firstCommit.slice(0, 7)}; reconcile first`,
    );
    expect(`${readRefs(lab.bare)}${readRefs(lab.origin)}`).toBe(before);
  });

  it("refuses unrelated history on public main before building", () => {
    const lab = makeLab();
    const first = runFresh(lab);
    const unrelated = pushStrayCommit(lab, true);
    commitSecondRelease(lab);
    const firstCommit = first.outcome?.publish?.commit ?? "";
    const before = `${readRefs(lab.bare)}${readRefs(lab.origin)}`;

    const { result } = runFresh(lab, { version: "0.2.0" });

    expect(!result.ok && result.error.reason).toBe(
      `public main at ${unrelated.slice(0, 7)} is not the last release commit ${firstCommit.slice(0, 7)}; reconcile first`,
    );
    expect(`${readRefs(lab.bare)}${readRefs(lab.origin)}`).toBe(before);
  });
});
