import { describe, expect, it } from "vitest";

import { runHandoff } from "../src/logic/handoff";
import type { CommandOutcome, CommandRunner, HandoffDeps } from "../src/types";

const OK = (stdout = ""): CommandOutcome => ({ status: 0, stdout, stderr: "" });

interface Script {
  readonly dirty?: boolean;
  readonly lockBefore?: string;
  readonly lockAfter?: string;
  readonly changed?: readonly string[];
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
      return OK(switched ? "new\n" : "old\n");
    }
    if (line === "rev-parse HEAD:pnpm-lock.yaml") {
      return OK(
        `${switched ? (script.lockAfter ?? "l1") : (script.lockBefore ?? "l1")}\n`,
      );
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
    if (line.startsWith("diff --name-only old new")) {
      return OK(`${(script.changed ?? []).join("\n")}\n`);
    }
    return { status: 1, stdout: "", stderr: `unexpected git ${line}` };
  };
  return { git, calls };
}

function makePnpm() {
  const calls: string[] = [];
  const pnpm: CommandRunner = (args) => {
    calls.push(args.join(" "));
    return OK();
  };
  return { pnpm, calls };
}

function makeDeps(
  git: CommandRunner,
  pnpm: CommandRunner,
  node = "v26.13.1",
): HandoffDeps {
  return { git, pnpm, nodeVersion: node, pinnedNodeVersion: "26.13.1\n" };
}

describe("runHandoff", () => {
  it("refuses to switch over uncommitted work", () => {
    const { git, calls } = makeGit({ dirty: true });

    const result = runHandoff(makeDeps(git, makePnpm().pnpm), "feat/x");

    expect(result.ok).toBe(false);
    expect(calls.some((call) => call.startsWith("switch"))).toBe(false);
  });

  it("installs, rebuilds web and asks for a restart when those moved", () => {
    const { git } = makeGit({
      lockBefore: "l1",
      lockAfter: "l2",
      changed: ["apps/web/src/a.tsx", "packages/types/src/b.ts"],
    });
    const pnpm = makePnpm();

    const result = runHandoff(makeDeps(git, pnpm.pnpm), "feat/x");

    expect(pnpm.calls).toEqual([
      "install --frozen-lockfile",
      "-C apps/web build",
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        "switched to feat/x",
        "lockfile changed: pnpm install --frozen-lockfile done",
        "web inputs changed: apps/web rebuilt",
        "api inputs changed: restart pnpm dev, the api does not reload",
        "node v26.13.1 matches .nvmrc",
      ].join("\n"),
    });
  });

  it("only switches when nothing downstream moved", () => {
    const { git } = makeGit({ changed: ["docs/readme.md"] });
    const pnpm = makePnpm();

    const result = runHandoff(makeDeps(git, pnpm.pnpm), "feat/x");

    expect(pnpm.calls).toEqual([]);
    expect(result.ok && result.value).toBe(
      "switched to feat/x\nnode v26.13.1 matches .nvmrc",
    );
  });

  it("warns when the shell's node is not the pinned one", () => {
    const { git } = makeGit({});

    const result = runHandoff(
      makeDeps(git, makePnpm().pnpm, "v23.1.0"),
      "feat/x",
    );

    expect(result.ok && result.value).toContain(
      "node v23.1.0 is not .nvmrc's 26.13.1: run nvm use before pnpm dev",
    );
  });

  it("passes git's refusal through", () => {
    const { git } = makeGit({ switchFails: true });

    const result = runHandoff(makeDeps(git, makePnpm().pnpm), "feat/x");

    expect(result).toEqual({
      ok: false,
      error: new Error(
        "git switch feat/x failed: fatal: 'x' is already used by worktree",
      ),
    });
  });
});
