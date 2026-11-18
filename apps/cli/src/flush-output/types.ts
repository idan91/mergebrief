import type { ValueOf } from "types/utils";

/** How a stream's queued output ended: all of it reached the OS, the reader hung up, or a write failed. */
export const StreamOutcomes = {
  FLUSHED: "flushed",
  READER_CLOSED: "reader-closed",
  FAILED: "failed",
} as const;
export type StreamOutcome = ValueOf<typeof StreamOutcomes>;

export interface WatchedStream {
  /** Resolves once every byte written so far reached the OS, or the stream failed. */
  readonly flush: () => Promise<StreamOutcome>;
}

/** What the run left behind for its last stderr lines and exit. */
export interface RunEnding {
  /** `runCli`'s exit code. */
  readonly code: number;
  readonly stdout: WatchedStream;
  readonly stderr: WatchedStream;
  readonly writeStderr: (line: string) => void;
  /** Lines held back during the run because only a successful run prints them. */
  readonly successNotices: readonly string[];
  /** The update check's nag, asked once the exit code is final. */
  readonly settleUpdateNag: (succeeded: boolean) => string | undefined;
}
