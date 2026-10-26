import {
  chmodSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGitPort,
  formatGitTimestamp,
  GitCommandError,
} from "../../src/logic/git-port";
import type { GitPort, ReleaseCommitInputs } from "../../src/types";
import { makeGitRepos, readGitOutput, runGit, type Tree } from "../helpers";

const made: string[] = [];

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const IDENTITY = {
  name: "Idan Ram",
  email: "44946814+Idan91@users.noreply.github.com",
};
const DATE = "2026-10-25T22:19:08Z";
const TOKEN = "ghs_sekrit";
const URL_SECRET = "fake-token";

const TREE: Tree = {
  "README.md": "read me\n",
  "docs/guide.md": "guide\n",
  "docs/internal/adr.md": "private\n",
};

/** A private clone with its origin, a bare public remote beside them, and the port over the clone. */
function makePort(tree: Tree = TREE) {
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
  const port = createGitPort(repos.clone, { env: process.env });
  return { repos, bare, port };
}

function commitFiles(clone: string, tree: Tree, message: string): string {
  for (const [path, content] of Object.entries(tree)) {
    mkdirSync(join(clone, path, ".."), { recursive: true });
    writeFileSync(join(clone, path), content);
  }
  runGit(clone, ["add", "--all"]);
  runGit(clone, ["commit", "--quiet", "-m", message]);
  return readGitOutput(clone, ["rev-parse", "HEAD"]);
}

function countLooseObjects(clone: string): number {
  const counted = runGit(clone, ["count-objects"]);
  return Number(counted.split(" ")[0]);
}

function makeInputs(
  port: GitPort,
  commit: string,
  paths = ["README.md", "docs/guide.md"],
): ReleaseCommitInputs {
  return {
    treeSha: port.writeTree(commit, paths),
    author: IDENTITY,
    committer: IDENTITY,
    date: DATE,
    message: "Release 0.1.0\n",
  };
}

/** Pushes `sha` to the bare's main and returns it, so a test can read what the port built. */
function publishMain(port: GitPort, bare: string, sha: string): string {
  port.pushPublic(bare, TOKEN, [`${sha}:refs/heads/main`]);
  return bare;
}

describe("reading the source commit", () => {
  it("reads the committer date as ISO 8601 with its offset", () => {
    const { repos, port } = makePort();

    expect(port.readCommitterDate(repos.head)).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/,
    );
  });

  it("lists co-author values over a range, or over all history", () => {
    const { repos, port } = makePort();
    commitFiles(
      repos.clone,
      { "a.txt": "a\n" },
      "a\n\nCo-authored-by: Ann Example <ann@example.org>\nCo-authored-by: Bob Example <bob@example.org>",
    );
    const tip = commitFiles(
      repos.clone,
      { "b.txt": "b\n" },
      "b\n\nCo-authored-by: Ann Example <ann@example.org>",
    );

    expect(port.listCoAuthorTrailers(repos.head, tip)).toEqual([
      "Ann Example <ann@example.org>",
      "Ann Example <ann@example.org>",
      "Bob Example <bob@example.org>",
    ]);
    expect(port.listCoAuthorTrailers(undefined, tip)).toHaveLength(3);
    expect(port.listCoAuthorTrailers(undefined, repos.head)).toEqual([]);
  });
});

describe("building the release tree", () => {
  it("writes a tree of exactly the named paths, outside the repository", () => {
    const { repos, bare, port } = makePort();
    const before = countLooseObjects(repos.clone);

    const commit = port.commitTree(makeInputs(port, repos.head));

    publishMain(port, bare, commit);
    const listed = runGit(bare, ["ls-tree", "-r", "--name-only", "main"]);
    const paths = listed.trim().split("\n");
    expect(paths).toEqual(["README.md", "docs/guide.md"]);
    expect(countLooseObjects(repos.clone)).toBe(before);
    expect(runGit(repos.clone, ["status", "--porcelain"])).toBe("");
    expect(runGit(repos.clone, ["for-each-ref"])).not.toContain(commit);
  });

  it("finds no difference between the tree and the dir git archive wrote", () => {
    const { repos, port } = makePort();
    writeFileSync(join(repos.clone, "run.sh"), "#!/bin/sh\n");
    chmodSync(join(repos.clone, "run.sh"), 0o755);
    symlinkSync("README.md", join(repos.clone, "LINK.md"));
    const commit = commitFiles(repos.clone, {}, "modes");
    const shipped = ["README.md", "docs/guide.md", "run.sh", "LINK.md"];
    const out = join(repos.root, "out");
    mkdirSync(out);
    port.archiveTo(commit, out, shipped);

    const tree = port.writeTree(commit, shipped);

    expect(port.verifyTreeMatchesDir(tree, out)).toEqual([]);
  });

  it("names every path where the dir differs from the tree", () => {
    const { repos, port } = makePort();
    const out = join(repos.root, "out");
    mkdirSync(out);
    port.archiveTo(repos.head, out, ["README.md", "docs/guide.md"]);
    writeFileSync(join(out, "README.md"), "edited\n");
    writeFileSync(join(out, "extra.md"), "extra\n");
    rmSync(join(out, "docs", "guide.md"));

    const tree = port.writeTree(repos.head, ["README.md", "docs/guide.md"]);

    expect(port.verifyTreeMatchesDir(tree, out)).toEqual([
      "README.md",
      "docs/guide.md",
      "extra.md",
    ]);
  });
});

describe("building the release commit", () => {
  it("gives the same SHA for the same inputs in two separate clones", () => {
    const first = makePort();
    const second = makePort();

    const left = first.port.commitTree(
      makeInputs(first.port, first.repos.head),
    );
    const right = second.port.commitTree(
      makeInputs(second.port, second.repos.head),
    );

    expect(left).toBe(right);
    publishMain(first.port, first.bare, left);
    expect(runGit(first.bare, ["cat-file", "-p", left])).toContain(
      `committer ${IDENTITY.name} <${IDENTITY.email}> 1792966748 +0000`,
    );
  });

  it("writes a parented commit and counts its changes against the parent", () => {
    const { repos, bare, port } = makePort();
    const root = port.commitTree(makeInputs(port, repos.head));
    rmSync(join(repos.clone, "docs", "guide.md"));
    const next = commitFiles(
      repos.clone,
      { "README.md": "changed\n", "NEW.md": "new\n" },
      "second",
    );

    const child = port.commitTree({
      ...makeInputs(port, next, ["README.md", "NEW.md"]),
      parent: root,
      message: "Release 0.2.0\n",
    });

    publishMain(port, bare, child);
    expect(readGitOutput(bare, ["rev-parse", "main^"])).toBe(root);
    expect(port.countTreeChanges(root, child)).toEqual({
      added: 1,
      edited: 1,
      deleted: 1,
    });
    expect(port.countTreeChanges(undefined, root)).toEqual({
      added: 2,
      edited: 0,
      deleted: 0,
    });
  });

  it("writes an annotated tag object with no ref, identical when rebuilt", () => {
    const { repos, bare, port } = makePort();
    const commit = port.commitTree(makeInputs(port, repos.head));
    const inputs = {
      name: "v0.1.0",
      target: commit,
      message: "Release 0.1.0\n",
      tagger: IDENTITY,
      date: DATE,
    };

    const tag = port.writeAnnotatedTag(inputs);

    expect(port.writeAnnotatedTag(inputs)).toBe(tag);
    expect(runGit(repos.clone, ["tag", "--list"])).toBe("");
    port.pushPublic(bare, TOKEN, [
      `${commit}:refs/heads/main`,
      `${tag}:refs/tags/v0.1.0`,
    ]);
    expect(readGitOutput(bare, ["cat-file", "-t", tag])).toBe("tag");
    expect(runGit(bare, ["cat-file", "-p", tag])).toContain(
      `object ${commit}\ntype commit\ntag v0.1.0\n`,
    );
  });

  it("knows an object only while the store or the repository holds it", () => {
    const { repos, port } = makePort();
    const commit = port.commitTree(makeInputs(port, repos.head));

    const before = port.hasObject(commit);
    port.discardScratchObjects();

    expect(before).toBe(true);
    expect(port.hasObject(repos.head)).toBe(true);
    expect(port.hasObject(commit)).toBe(false);
  });

  it("discards the scratch objects, so a later push cannot find them", () => {
    const { repos, bare, port } = makePort();
    const before = countLooseObjects(repos.clone);
    const commit = port.commitTree(makeInputs(port, repos.head));

    port.discardScratchObjects();

    const push = (): void => {
      port.pushPublic(bare, TOKEN, [`${commit}:refs/heads/main`]);
    };
    expect(push).toThrow(GitCommandError);
    expect(countLooseObjects(repos.clone)).toBe(before);
  });
});

describe("talking to the public remote", () => {
  it("reads an empty public repository as no main and no tags", () => {
    const { bare, port } = makePort();

    expect(port.fetchPublic(bare)).toEqual({ tags: new Map() });
  });

  it("reads main and the peeled v tags once releases exist", () => {
    const { repos, bare, port } = makePort();
    const commit = port.commitTree(makeInputs(port, repos.head));
    const tag = port.writeAnnotatedTag({
      name: "v0.1.0",
      target: commit,
      message: "Release 0.1.0\n",
      tagger: IDENTITY,
      date: DATE,
    });
    port.pushPublic(bare, TOKEN, [
      `${commit}:refs/heads/main`,
      `${tag}:refs/tags/v0.1.0`,
    ]);
    runGit(bare, ["tag", "other", "main"]);

    const refs = port.fetchPublic(bare);

    expect(refs).toEqual({ main: commit, tags: new Map([["v0.1.0", commit]]) });
  });

  it("says when no repository answers at the URL", () => {
    const { repos, port } = makePort();

    const missing = join(repos.root, "missing.git");

    expect(port.fetchPublic(missing)).toBeUndefined();
  });

  it("refuses a non fast-forward push instead of forcing it", () => {
    const { repos, bare, port } = makePort();
    const first = port.commitTree(makeInputs(port, repos.head));
    publishMain(port, bare, first);
    const other = port.commitTree({
      ...makeInputs(port, repos.head),
      message: "Stray\n",
    });

    const push = (): void => {
      port.pushPublic(bare, TOKEN, [`${other}:refs/heads/main`]);
    };

    expect(push).toThrow(GitCommandError);
    expect(readGitOutput(bare, ["rev-parse", "main"])).toBe(first);
  });

  it("never carries the token into a failure message", () => {
    const { repos, port } = makePort();
    const commit = port.commitTree(makeInputs(port, repos.head));

    const push = (): void => {
      port.pushPublic(join(repos.root, "missing.git"), TOKEN, [
        `${commit}:refs/heads/main`,
      ]);
    };

    expect(push).toThrow(GitCommandError);
    expect(push).not.toThrow(new RegExp(TOKEN));
    expect(push).toThrow(/MERGEBRIEF_PUBLISH_TOKEN/);
  });

  it("strips URL credentials from a failed git command's message", () => {
    const { repos, port } = makePort();
    const commit = port.commitTree(makeInputs(port, repos.head));
    const missing = join(repos.root, "missing.git");
    const url = `file://user:${URL_SECRET}@${missing}`;

    const push = (): void => {
      port.pushPublic(url, TOKEN, [`${commit}:refs/heads/main`]);
    };

    expect(push).toThrow(GitCommandError);
    expect(push).not.toThrow(new RegExp(URL_SECRET));
    expect(push).toThrow(/file:\/\/<redacted>@/);
  });
});

describe("the private release records", () => {
  it("lists no records on a remote without public tags", () => {
    const { port } = makePort();

    expect(port.listRecords()).toEqual({ ok: true, value: [] });
  });

  it("round-trips a record through the private remote", () => {
    const { repos, bare, port } = makePort();
    const commit = port.commitTree(makeInputs(port, repos.head));
    publishMain(port, bare, commit);
    const record = port.writeAnnotatedTag({
      name: "public/v0.1.0",
      target: repos.head,
      message: `public-commit ${commit}\n`,
      tagger: IDENTITY,
      date: DATE,
    });

    port.pushRecord("0.1.0", record);

    expect(port.listRecords()).toEqual({
      ok: true,
      value: [{ version: "0.1.0", source: repos.head, publicCommit: commit }],
    });
    expect(runGit(repos.clone, ["tag", "--list"])).toBe("");
    const remoteTags = runGit(repos.clone, [
      "ls-remote",
      "--tags",
      "--refs",
      "origin",
    ]);
    expect(remoteTags.trim()).toMatch(
      /^[0-9a-f]{40}\trefs\/tags\/public\/v0\.1\.0$/,
    );
  });

  it("refuses a record tag whose message names no public commit", () => {
    const { repos, port } = makePort();
    const record = port.writeAnnotatedTag({
      name: "public/v0.1.0",
      target: repos.head,
      message: "hand made\n",
      tagger: IDENTITY,
      date: DATE,
    });

    port.pushRecord("0.1.0", record);

    expect(port.listRecords()).toEqual({
      ok: false,
      error:
        "refs/tags/public/v0.1.0 is not a release record; fix the tag by hand",
    });
  });
});

describe("a stand-in private remote", () => {
  it("reads main and the records there when origin cannot answer", () => {
    const { repos } = makePort();
    runGit(repos.clone, ["remote", "set-url", "origin", "/nonexistent.git"]);
    const port = createGitPort(repos.clone, {
      env: process.env,
      privateRemote: join(repos.root, "remote.git"),
    });

    port.fetchDefaultBranch();

    expect(port.isOnDefaultBranch(repos.head)).toBe(true);
    expect(port.listRecords()).toEqual({ ok: true, value: [] });
  });
});

describe("git timestamps", () => {
  it("turns an ISO date into seconds and a numeric offset", () => {
    expect(formatGitTimestamp(DATE)).toBe("1792966748 +0000");
    expect(formatGitTimestamp("2026-10-25T23:19:08+01:00")).toBe(
      "1792966748 +0100",
    );
    expect(formatGitTimestamp("2026-10-25T17:19:08-05:00")).toBe(
      "1792966748 -0500",
    );
  });
});
