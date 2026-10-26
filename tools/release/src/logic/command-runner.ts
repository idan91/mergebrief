import { spawnSync } from "node:child_process";

import type { CommandRunner } from "../types";

const STDERR_FD = 2;

/**
 * Spawns a gate's tool with its output on our stderr, so stdout carries
 * only the export's own report. `baseEnv` comes from the composition root.
 */
export function createCommandRunner(
  baseEnv: Readonly<Record<string, string | undefined>>,
): CommandRunner {
  return {
    run(spec) {
      const ran = spawnSync(spec.command, spec.args, {
        cwd: spec.cwd,
        env: { ...baseEnv, ...spec.env },
        stdio: ["ignore", STDERR_FD, STDERR_FD],
      });
      if (ran.error !== undefined) {
        const error = `${spec.command} could not start: ${ran.error.message}`;
        return { ok: false, error };
      }
      if (ran.status === null) {
        const error = `${spec.command} was stopped by ${ran.signal ?? "a signal"}`;
        return { ok: false, error };
      }
      return { ok: true, value: ran.status };
    },
  };
}
