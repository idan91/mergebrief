import { describe, expect, it } from "vitest";
import { computeNextVersion, executeCut, planCut } from "../src/logic/cut";
import { GitCommandError } from "../src/logic/git-port";
import { formatReleaseVersion } from "../src/logic/version";
import {
  type BumpLevel,
  BumpLevels,
  type CutPlan,
  type GitPort,
} from "../src/types";
import { DEFAULT_BRANCH_REF } from "../src/consts";
import { makeNotesFile } from "./helpers";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const NOTES = makeNotesFile({}, "## What changed\n\nOne line.\n");

interface FakeGitState {
  readonly remoteTags: readonly string[];
  readonly localTags?: readonly string[];
  readonly onMain?: boolean;
  readonly files?: Readonly<Record<string, string>>;
  readonly pushFails?: boolean;
}

interface FakeGit {
  readonly port: GitPort;
  readonly fetched: number;
  readonly created: string[];
  readonly pushed: string[];
}

function makeFakeGit(state: FakeGitState): FakeGit {
  const created: string[] = [];
  const pushed: string[] = [];
  const fake = { fetched: 0 };
  const port: GitPort = {
    fetchDefaultBranch: () => {
      fake.fetched += 1;
    },
    listRemoteTags: () => state.remoteTags,
    resolveCommit: (ref) =>
      ref === DEFAULT_BRANCH_REF || ref === COMMIT ? COMMIT : undefined,
    isOnDefaultBranch: () => state.onMain ?? true,
    readFileAt: (_commit, path) => state.files?.[path],
    hasLocalTag: (tag) => state.localTags?.includes(tag) ?? false,
    createTag: (tag) => {
      created.push(tag);
    },
    pushTag: (tag) => {
      if (state.pushFails) {
        throw new GitCommandError(["push"], "fatal: remote rejected\n");
      }
      pushed.push(tag);
    },
    listTrackedPaths: () => [],
    archiveTo: () => undefined,
  };
  return {
    port,
    get fetched() {
      return fake.fetched;
    },
    created,
    pushed,
  };
}

function formatNextVersion(
  tags: readonly string[],
  level: BumpLevel,
  candidate = false,
): string {
  return formatReleaseVersion(computeNextVersion(tags, level, candidate));
}

function makeNotesAt(version: string): Readonly<Record<string, string>> {
  return { [`docs/releases/${version}.md`]: NOTES };
}

describe("the next version over the published tags", () => {
  it("bumps the highest stable tag by the level", () => {
    const tags = ["v0.2.3", "v0.2.1", "v0.3.0-rc.1"];

    expect(formatNextVersion(tags, BumpLevels.PATCH)).toBe("0.2.4");
    expect(formatNextVersion(tags, BumpLevels.MINOR)).toBe("0.3.0");
    expect(formatNextVersion(tags, BumpLevels.MAJOR)).toBe("1.0.0");
  });

  it("starts from 0.0.0 when nothing stable was published", () => {
    expect(formatNextVersion([], BumpLevels.MINOR)).toBe("0.1.0");
    expect(formatNextVersion(["v0.1.0-rc.1"], BumpLevels.MINOR)).toBe("0.1.0");
  });

  it("numbers a candidate after the candidates of the same version", () => {
    expect(formatNextVersion(["v0.2.3"], BumpLevels.MINOR, true)).toBe(
      "0.3.0-rc.1",
    );
    expect(
      formatNextVersion(["v0.2.3", "v0.3.0-rc.2"], BumpLevels.MINOR, true),
    ).toBe("0.3.0-rc.3");
  });

  it("ignores tags outside the release grammar", () => {
    const tags = ["v0.2.3", "latest", "v1.0", "v0.9.0-beta"];

    expect(formatNextVersion(tags, BumpLevels.PATCH)).toBe("0.2.4");
  });
});

describe("planning a cut", () => {
  it("fetches main and tags its tip, naming the tag and notes file", () => {
    const git = makeFakeGit({
      remoteTags: ["v0.2.3"],
      files: makeNotesAt("0.2.4"),
    });

    const plan = planCut(git.port, {
      level: BumpLevels.PATCH,
      candidate: false,
    });

    expect(plan.ok && plan.value).toEqual({
      version: "0.2.4",
      tag: "v0.2.4",
      commit: COMMIT,
      notesPath: "docs/releases/0.2.4.md",
    });
    expect(git.fetched).toBe(1);
    expect(git.created).toEqual([]);
  });

  it("refuses a ref that is not a commit", () => {
    const git = makeFakeGit({ remoteTags: [] });

    const plan = planCut(git.port, {
      level: BumpLevels.PATCH,
      ref: "nope",
      candidate: false,
    });

    expect(!plan.ok && plan.error.reason).toBe("nope is not a commit");
  });

  it("refuses a commit that is not on the default branch", () => {
    const git = makeFakeGit({ remoteTags: [], onMain: false });

    const plan = planCut(git.port, {
      level: BumpLevels.PATCH,
      candidate: false,
    });

    expect(!plan.ok && plan.error.reason).toContain(
      "not on the default branch",
    );
  });

  it("refuses when the tag already exists locally", () => {
    const git = makeFakeGit({
      remoteTags: ["v0.2.3"],
      localTags: ["v0.2.4"],
      files: makeNotesAt("0.2.4"),
    });

    const plan = planCut(git.port, {
      level: BumpLevels.PATCH,
      candidate: false,
    });

    expect(!plan.ok && plan.error.reason).toContain(
      "v0.2.4 already exists locally",
    );
  });

  it("refuses when the notes file is not in the commit", () => {
    const git = makeFakeGit({
      remoteTags: ["v0.2.3"],
      files: makeNotesAt("0.2.3"),
    });

    const plan = planCut(git.port, {
      level: BumpLevels.PATCH,
      candidate: false,
    });

    expect(!plan.ok && plan.error.reason).toContain(
      "docs/releases/0.2.4.md is not in",
    );
  });

  it("refuses a notes file that does not parse", () => {
    const git = makeFakeGit({
      remoteTags: ["v0.2.3"],
      files: { "docs/releases/0.2.4.md": "no front matter\n" },
    });

    const plan = planCut(git.port, {
      level: BumpLevels.PATCH,
      candidate: false,
    });

    expect(!plan.ok && plan.error.reason).toContain("front matter must open");
  });
});

describe("executing a cut", () => {
  const plan: CutPlan = {
    version: "0.2.4",
    tag: "v0.2.4",
    commit: COMMIT,
    notesPath: "docs/releases/0.2.4.md",
  };

  it("writes the tag and pushes only when asked", () => {
    const quiet = makeFakeGit({ remoteTags: [] });
    const pushing = makeFakeGit({ remoteTags: [] });

    const quietDone = executeCut(quiet.port, plan, false);
    const pushingDone = executeCut(pushing.port, plan, true);

    expect(quietDone.ok && pushingDone.ok).toBe(true);
    expect(quiet.created).toEqual(["v0.2.4"]);
    expect(quiet.pushed).toEqual([]);
    expect(pushing.pushed).toEqual(["v0.2.4"]);
  });

  it("reports the local tag and the retry when the push fails", () => {
    const git = makeFakeGit({ remoteTags: [], pushFails: true });

    const done = executeCut(git.port, plan, true);

    expect(git.created).toEqual(["v0.2.4"]);
    expect(!done.ok && done.error.reason).toBe(
      "v0.2.4 is tagged locally but the push failed (fatal: remote rejected); retry with: git push origin v0.2.4",
    );
  });
});
