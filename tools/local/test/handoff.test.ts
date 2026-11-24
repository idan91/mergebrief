import { describe, expect, it } from "vitest";

import { runHandoff, WEB_BUILD_STAMP } from "../src/logic/handoff";
import type { CommandOutcome, CommandRunner, HandoffDeps } from "../src/types";

const OK = (stdout = ""): CommandOutcome => ({ status: 0, stdout, stderr: "" });

interface Script {
  readonly dirty?: boolean;
  readonly sameHead?: boolean;
  /** `git diff --name-only <from> <to>` output keyed by "from..to". */
  readonly diffs?: Readonly<Record<string, readonly string[]>>;
  readonly switchFails?: boolean;
}

function makeGit(script: Script) {
  const calls: string[] = [];
  let switched = false;
  const git: CommandRunner = (args) => {
    const line = args.join(" ");
    calls.push(line);
    if (line.startsWith("status --porcelain")) {
      return OK(script.dirty === true ? " M a.ts\n" : "");
    }
    if (line === "rev-parse HEAD") {
      return OK(switched && script.sameHead !== true ? "new\n" : "old\n");
    }
    if (line.startsWith("switch")) {
      if (script.switchFails === true) {
        return {
          status: 128,
          stdout: "",
          stderr: "fatal: 'x' is already used by worktree",
        };
      }
      switched = true;
      return OK();
    }
    if (line.startsWith("diff --name-only")) {
      const key = `${args[2] ?? ""}..${args[3] ?? ""}`;
      return OK(`${(script.diffs?.[key] ?? []).join("\n")}\n`);
    }
    return { status: 1, stdout: "", stderr: `unexpected git ${line}` };
  };
  return { git, calls };
}

function makePnpm(failing?: string) {
  const calls: string[] = [];
  const pnpm: CommandRunner = (args) => {
    const line = args.join(" ");
    calls.push(line);
    return line === failing
      ? { status: 1, stdout: "", stderr: "ERR_PNPM_FETCH" }
      : OK();
  };
  return { pnpm, calls };
}

function makeFiles(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    store: {
      read: (path: string) => files.get(path),
      write: (path: string, content: string) => {
        files.set(path, content);
      },
    },
  };
}

const IN_SYNC = {
  "pnpm-lock.yaml": "lock",
  "node_modules/.pnpm/lock.yaml": "lock",
  [WEB_BUILD_STAMP]: "new\n",
};

function makeDeps(
  git: CommandRunner,
  pnpm: CommandRunner,
  files: HandoffDeps["files"],
  node = "v26.13.1",
): HandoffDeps {
  return {
    git,
    pnpm,
    files,
    nodeVersion: node,
    pinnedNodeVersion: "26.13.1\n",
  };
}

describe("runHandoff", () => {
  it("refuses to switch over uncommitted work", () => {
    const { git, calls } = makeGit({ dirty: true });

    const result = runHandoff(
      makeDeps(git, makePnpm().pnpm, makeFiles(IN_SYNC).store),
      "feat/x",
    );

    expect(result.ok).toBe(false);
    expect(calls.some((call) => call.startsWith("switch"))).toBe(false);
  });

  it("installs, rebuilds web and asks for a restart when those are stale", () => {
    const { git } = makeGit({
      diffs: {
        "old..new": ["apps/api/src/a.ts"],
        "built..new": ["apps/web/src/a.tsx"],
      },
    });
    const pnpm = makePnpm();
    const { files, store } = makeFiles({
      "pnpm-lock.yaml": "lock-2",
      "node_modules/.pnpm/lock.yaml": "lock-1",
      [WEB_BUILD_STAMP]: "built\n",
    });

    const result = runHandoff(makeDeps(git, pnpm.pnpm, store), "feat/x");

    expect(pnpm.calls).toEqual([
      "install --frozen-lockfile",
      "-C apps/web build",
    ]);
    expect(files.get(WEB_BUILD_STAMP)).toBe("new\n");
    expect(result).toEqual({
      ok: true,
      value: [
        "switched to feat/x",
        "dependencies were stale: pnpm install --frozen-lockfile done",
        "web dist was stale: apps/web rebuilt",
        "api inputs changed: restart pnpm dev, the api does not reload",
        "node v26.13.1 matches .nvmrc",
      ].join("\n"),
    });
  });

  it("only switches when installs and the web build are current", () => {
    const { git } = makeGit({ diffs: { "old..new": ["docs/readme.md"] } });
    const pnpm = makePnpm();

    const result = runHandoff(
      makeDeps(git, pnpm.pnpm, makeFiles(IN_SYNC).store),
      "feat/x",
    );

    expect(pnpm.calls).toEqual([]);
    expect(result.ok && result.value).toBe(
      "switched to feat/x\nnode v26.13.1 matches .nvmrc",
    );
  });

  it("catches up on a rerun after a failed install, though HEAD stayed", () => {
    const { git } = makeGit({ sameHead: true });
    const pnpm = makePnpm();
    const { store } = makeFiles({
      ...IN_SYNC,
      "node_modules/.pnpm/lock.yaml": "old-lock",
    });

    runHandoff(makeDeps(git, pnpm.pnpm, store), "feat/x");

    expect(pnpm.calls).toContain("install --frozen-lockfile");
  });

  it("rebuilds web when no build stamp exists", () => {
    const { git } = makeGit({});
    const pnpm = makePnpm();
    const { store } = makeFiles({
      "pnpm-lock.yaml": "l",
      "node_modules/.pnpm/lock.yaml": "l",
    });

    runHandoff(makeDeps(git, pnpm.pnpm, store), "feat/x");

    expect(pnpm.calls).toEqual(["-C apps/web build"]);
  });

  it("says where the checkout is when a step after the switch fails", () => {
    const { git } = makeGit({});
    const pnpm = makePnpm("install --frozen-lockfile");
    const { store } = makeFiles({
      ...IN_SYNC,
      "node_modules/.pnpm/lock.yaml": "old-lock",
    });

    const result = runHandoff(makeDeps(git, pnpm.pnpm, store), "feat/x");

    expect(result.ok ? "" : result.error.message).toBe(
      "now on feat/x, but pnpm install failed: ERR_PNPM_FETCH; rerun pnpm checkout:handoff feat/x to finish",
    );
  });

  it("warns when the shell's node is not the pinned one", () => {
    const { git } = makeGit({});

    const result = runHandoff(
      makeDeps(git, makePnpm().pnpm, makeFiles(IN_SYNC).store, "v23.1.0"),
      "feat/x",
    );

    expect(result.ok && result.value).toContain(
      "node v23.1.0 is not .nvmrc's 26.13.1: run nvm use before pnpm dev",
    );
  });

  it("passes git's refusal through", () => {
    const { git } = makeGit({ switchFails: true });

    const result = runHandoff(
      makeDeps(git, makePnpm().pnpm, makeFiles(IN_SYNC).store),
      "feat/x",
    );

    expect(result).toEqual({
      ok: false,
      error: new Error(
        "git switch feat/x failed: fatal: 'x' is already used by worktree",
      ),
    });
  });
});
