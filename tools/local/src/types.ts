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
  /** Repo-relative file access; `read` is undefined for a missing file. */
  readonly files: {
    readonly read: (path: string) => string | undefined;
    readonly write: (path: string, content: string) => void;
  };
  /** `node --version` of the shell that runs the dev server. */
  readonly nodeVersion: string;
  /** Contents of `.nvmrc`. */
  readonly pinnedNodeVersion: string;
}

export interface ProcessControl {
  readonly isAlive: (pid: number) => boolean;
  /** The process's command line, or undefined when it cannot be read. */
  readonly readCommandLine: (pid: number) => string | undefined;
  /** Sends SIGTERM; false when the signal could not be delivered. */
  readonly terminate: (pid: number) => boolean;
}

export interface E2eStopDeps {
  /** This checkout's e2e artifacts; orphans are cleaned up only here. */
  readonly artifactsDir: string;
  /** Every worktree's artifacts, this one included: a live owner anywhere claims the shared container. */
  readonly allArtifactsDirs: readonly string[];
  readonly docker: CommandRunner;
  /** `pgrep -f` for the given pattern. */
  readonly pgrep: CommandRunner;
  readonly processes: ProcessControl;
}
