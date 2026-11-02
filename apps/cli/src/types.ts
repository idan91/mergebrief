import type { FetchLike } from "./client";

export interface CliDeps {
  readonly fetch: FetchLike;
  /** Read a file for `submit -F <file>`; injected for tests. */
  readonly readFile?: ((path: string) => string) | undefined;
  /** Read an image for `draft attach <file>`; injected for tests. */
  readonly readBinaryFile?: ((path: string) => Uint8Array) | undefined;
  /** `$PAGER` hook for `diff` on a TTY (cosmetic); optional. */
  readonly pager?: ((text: string) => Promise<void>) | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly configDir: string;
  readonly cacheDir: string;
  /** Raw stdout sink, receives EXACT bytes (passthrough, no re-framing). */
  readonly stdout: (text: string) => void;
  /** One-line stderr sink. */
  readonly stderr: (line: string) => void;
  /** Sink for a line only a successful run prints (the major-gap warning); `stderr` when absent. */
  readonly successNotice?: (line: string) => void;
  /** Read the pasted/piped token for `auth login`. */
  readonly readStdin: () => Promise<string>;
  /** `git remote get-url origin`, or undefined outside a repo. */
  readonly gitOriginUrl: () => string | undefined;
  /** The build-time version by default; a test seam for the skew lines. */
  readonly cliVersion?: string | undefined;
}

export interface GlobalOptions {
  readonly json: boolean;
  readonly profile?: string;
  /** `-R owner/name`, overrides origin-remote inference. */
  readonly repo?: string;
}

/** The base..head span of the brief a session command addresses. */
export interface BriefSpan {
  readonly base: string;
  readonly head: string;
}

/** The output sinks a command writes to, and which contract it writes. */
export interface CommandIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (line: string) => void;
  /** A stderr line that prints only once the command exits 0, after stdout flushed. */
  readonly successNotice: (line: string) => void;
  readonly json: boolean;
}

/** What a command family's wiring needs: the run's deps and its global flags,
 * read at action time because commander parses them after registration. */
export interface CommandContext {
  readonly deps: CliDeps;
  readonly readGlobals: () => GlobalOptions;
}
