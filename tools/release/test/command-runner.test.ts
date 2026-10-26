import { tmpdir } from "node:os";
import type { Mutable } from "types/utils";
import { describe, expect, it } from "vitest";
import { createCommandRunner } from "../src/logic/command-runner";
import type { CommandSpec } from "../src/types";

const runner = createCommandRunner(process.env);

function runNode(script: string, env?: Readonly<Record<string, string>>) {
  const spec: Mutable<CommandSpec> = {
    command: process.execPath,
    args: ["-e", script],
    cwd: tmpdir(),
  };
  if (env !== undefined) {
    spec.env = env;
  }
  return runner.run(spec);
}

describe("the command runner", () => {
  it("returns the exit code of the command it ran", () => {
    expect(runNode("process.exit(3)")).toEqual({ ok: true, value: 3 });
    expect(runNode("")).toEqual({ ok: true, value: 0 });
  });

  it("lays the spec's env over the base env", () => {
    const script =
      "process.exit(process.env.EXPORT_PROBE === 'set' && process.env.PATH ? 0 : 1)";

    expect(runNode(script, { EXPORT_PROBE: "set" })).toEqual({
      ok: true,
      value: 0,
    });
  });

  it("says why a command could not start", () => {
    const started = runner.run({
      command: "no-such-command-anywhere",
      args: [],
      cwd: tmpdir(),
    });

    expect(!started.ok && started.error).toMatch(
      /^no-such-command-anywhere could not start: /,
    );
  });
});
