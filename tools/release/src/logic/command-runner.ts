import { spawnSync, type SpawnSyncReturns } from "node:child_process";

import type { Result } from "types/utils";

import type { CommandRunner, CommandSpec } from "../types";
import { type ChildEnv, stripCredentialVariables } from "./credential-env";

const STDERR_FD = 2;
const CAPTURED_STDERR_MAX_MIB = 16;
const CAPTURED_STDERR_MAX_BYTES = CAPTURED_STDERR_MAX_MIB * 1024 * 1024;

function readExitStatus(
  spec: CommandSpec,
  ran: SpawnSyncReturns<unknown>,
): Result<number, string> {
  if (ran.error !== undefined) {
    const error = `${spec.command} could not start: ${ran.error.message}`;
    return { ok: false, error };
  }
  if (ran.status === null) {
    const error = `${spec.command} was stopped by ${ran.signal ?? "a signal"}`;
    return { ok: false, error };
  }
  return { ok: true, value: ran.status };
}

function isBufferOverflow(error: Error | undefined): boolean {
  return error !== undefined && "code" in error && error.code === "ENOBUFS";
}

/**
 * Spawns a gate's tool with its output on our stderr, so stdout carries
 * only the export's own report. `baseEnv` comes from the composition root;
 * the tool never sees a credential-shaped variable from it or from the spec.
 */
export function createCommandRunner(baseEnv: ChildEnv): CommandRunner {
  function buildEnv(spec: CommandSpec): ChildEnv {
    return stripCredentialVariables({ ...baseEnv, ...spec.env });
  }

  return {
    run(spec) {
      const ran = spawnSync(spec.command, spec.args, {
        cwd: spec.cwd,
        env: buildEnv(spec),
        stdio: ["ignore", STDERR_FD, STDERR_FD],
      });
      return readExitStatus(spec, ran);
    },
    runCapturingStderr(spec) {
      const ran = spawnSync(spec.command, spec.args, {
        cwd: spec.cwd,
        env: buildEnv(spec),
        stdio: ["ignore", STDERR_FD, "pipe"],
        encoding: "utf8",
        maxBuffer: CAPTURED_STDERR_MAX_BYTES,
      });
      if (isBufferOverflow(ran.error)) {
        const error = `${spec.command} wrote more than ${CAPTURED_STDERR_MAX_MIB} MiB of log`;
        return { ok: false, error };
      }

      const status = readExitStatus(spec, ran);
      if (ran.error === undefined) {
        process.stderr.write(ran.stderr);
      }
      if (!status.ok) {
        return status;
      }
      return { ok: true, value: { status: status.value, stderr: ran.stderr } };
    },
  };
}
