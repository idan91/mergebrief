/** Runs one CLI process and reports its outcome without throwing. */
export type CommandRunner = (args: readonly string[]) => CommandOutcome;

export interface CommandOutcome {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface HandoffDeps {
  readonly git: CommandRunner;
  readonly pnpm: CommandRunner;
  /** `node --version` of the shell that runs the dev server. */
  readonly nodeVersion: string;
  /** Contents of `.nvmrc`. */
  readonly pinnedNodeVersion: string;
}

export interface ProcessControl {
  readonly isAlive: (pid: number) => boolean;
  /** The process's command line, or undefined when it cannot be read. */
  readonly commandOf: (pid: number) => string | undefined;
  /** Sends SIGTERM; false when the signal could not be delivered. */
  readonly terminate: (pid: number) => boolean;
}

export interface E2eStopDeps {
  readonly artifactsDir: string;
  readonly docker: CommandRunner;
  /** `pgrep -f` for the given pattern. */
  readonly pgrep: CommandRunner;
  readonly processes: ProcessControl;
}
