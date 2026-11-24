import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { recordReply } from "../src/logic/replies";
import { runStackStatus } from "../src/logic/stack-status";
import type { CommandOutcome, CommandRunner } from "../src/types";

const OK = (stdout = ""): CommandOutcome => ({ status: 0, stdout, stderr: "" });

const OPEN_HEAD = "1a2b3c4d5e6f7a8b9c0d";

function makeGh(): CommandRunner {
  const pull = (number: number, head: string, base: string, sha: string) => ({
    number,
    state: "OPEN",
    isDraft: true,
    headRefName: head,
    baseRefName: base,
    headRefOid: sha,
    commits: { nodes: [{ commit: { committedDate: "2026-11-24T10:00:00Z" } }] },
    reviews: { nodes: [] },
    comments: {
      nodes: [
        {
          databaseId: 5,
          author: { login: "idan91", __typename: "User" },
          createdAt: "2026-11-24T12:00:00Z",
        },
      ],
    },
    reviewThreads: {
      nodes: [
        {
          isResolved: false,
          isOutdated: false,
          comments: {
            nodes: [
              {
                databaseId: 100 + number,
                author: { login: "idan91", __typename: "User" },
                createdAt: "2026-11-24T11:00:00Z",
                path: "src/a.ts",
                line: 3,
              },
            ],
          },
        },
      ],
    },
  });
  const response = {
    data: {
      repository: {
        pr1: pull(1, "chore/T-1/1-a", "main", "b".repeat(40)),
        pr2: pull(2, "chore/T-1/2-b", "chore/T-1/1-a", OPEN_HEAD),
      },
    },
  };
  return () => OK(JSON.stringify(response));
}

interface GitScript {
  readonly branch: string;
  readonly head: string;
  readonly dirty: boolean;
  readonly misaligned: readonly string[];
}

function makeGit(script: GitScript) {
  const calls: string[] = [];
  function run(args: readonly string[]): CommandOutcome {
    const line = args.join(" ");
    calls.push(line);
    if (line === "remote get-url origin") {
      return OK("git@github.com:idan91/mergebrief.git\n");
    }
    if (line.startsWith("fetch")) {
      return OK();
    }
    if (line.startsWith("merge-base --is-ancestor")) {
      const head = args.at(-1) ?? "";
      return {
        status: script.misaligned.includes(head) ? 1 : 0,
        stdout: "",
        stderr: "",
      };
    }
    if (line === "branch --show-current") {
      return OK(`${script.branch}\n`);
    }
    if (line === "rev-parse HEAD") {
      return OK(`${script.head}\n`);
    }
    if (line.startsWith("status --porcelain")) {
      return OK(script.dirty ? " M src/a.ts\n" : "");
    }
    return { status: 128, stdout: "", stderr: `unexpected git ${line}` };
  }
  return { run, calls };
}

function makeStore(): string {
  return join(mkdtempSync(join(tmpdir(), "pr-status-")), "replies.json");
}

describe("runStackStatus", () => {
  it("reports alignment, open threads, new activity and the checkout", () => {
    const git = makeGit({
      branch: "chore/T-1/2-b",
      head: OPEN_HEAD,
      dirty: false,
      misaligned: [],
    });

    const result = runStackStatus(
      { git: git.run, gh: makeGh(), replyStorePath: makeStore() },
      [1, 2],
    );

    expect(result.ok).toBe(true);
    const text = result.ok ? result.value.text : "";
    expect(text).toContain("#1 open draft  chore/T-1/1-a -> main");
    expect(text).toContain("base     aligned");
    expect(text).toContain(
      "threads  1 open: 101 src/a.ts:3 (idan91 2026-11-24T11:00:00Z)",
    );
    expect(text).toContain("since head 1 comment by idan91");
    expect(text).toContain(
      "checkout chore/T-1/2-b at 1a2b3c4d5e, matches the top PR",
    );
    expect(result.ok && result.value.needsAttention).toBe(true);
    expect(git.calls).toContain(
      "fetch -q origin main chore/T-1/1-a chore/T-1/2-b",
    );
  });

  it("flags a head that no longer contains its base", () => {
    const git = makeGit({
      branch: "chore/T-1/2-b",
      head: OPEN_HEAD,
      dirty: false,
      misaligned: ["origin/chore/T-1/2-b"],
    });

    const result = runStackStatus(
      { git: git.run, gh: makeGh(), replyStorePath: makeStore() },
      [1, 2],
    );

    expect(result.ok && result.value.text).toContain(
      "base     BEHIND chore/T-1/1-a: rebase onto it",
    );
  });

  it("warns when the main checkout is off the top PR", () => {
    const git = makeGit({
      branch: "main",
      head: "c".repeat(40),
      dirty: true,
      misaligned: [],
    });

    const result = runStackStatus(
      { git: git.run, gh: makeGh(), replyStorePath: makeStore() },
      [1, 2],
    );

    expect(result.ok && result.value.text).toContain(
      "checkout main at cccccccccc (uncommitted changes), NOT the top PR chore/T-1/2-b at 1a2b3c4d5e",
    );
  });

  it("drops threads answered through the reply command", () => {
    const store = makeStore();
    recordReply(store, 101);
    recordReply(store, 102);
    const git = makeGit({
      branch: "chore/T-1/2-b",
      head: OPEN_HEAD,
      dirty: false,
      misaligned: [],
    });

    const result = runStackStatus(
      { git: git.run, gh: makeGh(), replyStorePath: store },
      [1, 2],
    );

    expect(result.ok && result.value.text).toContain("threads  none open");
  });

  it("fails when origin is not a GitHub remote", () => {
    function git(args: readonly string[]): CommandOutcome {
      return args[0] === "remote" ? OK("/srv/repo.git\n") : OK();
    }

    const result = runStackStatus(
      { git, gh: makeGh(), replyStorePath: makeStore() },
      [1],
    );

    expect(result.ok).toBe(false);
  });
});
