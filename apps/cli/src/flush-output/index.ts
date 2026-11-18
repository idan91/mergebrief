import type { Writable } from "node:stream";

import { ExitCodes } from "../exit";
import {
  type RunEnding,
  type StreamOutcome,
  StreamOutcomes,
  type WatchedStream,
} from "./types";

/** The reader left on purpose (`| head`); a socket reader reports a reset instead. */
const READER_CLOSED_CODES: ReadonlySet<string> = new Set([
  "EPIPE",
  "ECONNRESET",
]);

function readErrorCode(error: Error): string | undefined {
  if ("code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

function classifyWriteError(error: Error): StreamOutcome {
  const code = readErrorCode(error);
  if (code !== undefined && READER_CLOSED_CODES.has(code)) {
    return StreamOutcomes.READER_CLOSED;
  }
  return StreamOutcomes.FAILED;
}

/**
 * Records the stream's first error from now on, so a reader hanging up
 * between two writes never surfaces as an unhandled `error` event. Call it
 * before the first write.
 */
export function watchStream(stream: Writable): WatchedStream {
  let firstError: Error | undefined;
  stream.on("error", (error: Error) => {
    firstError ??= error;
  });

  return {
    flush: () =>
      new Promise((resolve) => {
        if (firstError !== undefined) {
          resolve(classifyWriteError(firstError));
          return;
        }
        // Write callbacks run in write order: this one fires after every earlier chunk.
        stream.write("", (error) => {
          resolve(
            error instanceof Error
              ? classifyWriteError(error)
              : StreamOutcomes.FLUSHED,
          );
        });
      }),
  };
}

/** A successful command whose stdout failed lost output; a failed command's stdout was empty anyway. */
export function resolveExitCode(code: number, stdout: StreamOutcome): number {
  const successLostOutput =
    stdout === StreamOutcomes.FAILED && code === ExitCodes.OK;
  if (successLostOutput) {
    return ExitCodes.GENERIC;
  }
  return code;
}

/**
 * Flushes stdout, settles the exit code, writes the stderr lines that code
 * allows, then flushes stderr. A failed exit gets exactly one stderr line.
 */
export async function resolveFinalExitCode(ending: RunEnding): Promise<number> {
  const exitCode = resolveExitCode(ending.code, await ending.stdout.flush());
  const succeeded = exitCode === ExitCodes.OK;

  if (exitCode !== ending.code) {
    ending.writeStderr("could not write the whole output to stdout");
  }
  if (succeeded) {
    for (const notice of ending.successNotices) {
      ending.writeStderr(notice);
    }
  }
  const nag = ending.settleUpdateNag(succeeded);
  if (nag !== undefined) {
    ending.writeStderr(nag);
  }

  await ending.stderr.flush();
  return exitCode;
}
