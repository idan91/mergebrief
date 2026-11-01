import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";

import { ExitCodes } from "../src/exit";
import {
  resolveExitCode,
  resolveFinalExitCode,
  watchStream,
} from "../src/flush-output";
import { type RunEnding, StreamOutcomes } from "../src/flush-output/types";

interface HeldStream {
  readonly stream: Writable;
  readonly written: string[];
  /** The reader starts draining: held writes complete, later ones pass straight through. */
  release(): void;
}

/** A writable that holds each write until released, like a pipe nobody drained. */
function makeHeldStream(): HeldStream {
  const written: string[] = [];
  const held: (() => void)[] = [];
  let draining = false;
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const complete = () => {
        written.push(chunk.toString("utf8"));
        callback();
      };
      if (draining) {
        complete();
        return;
      }
      held.push(complete);
    },
  });
  return {
    stream,
    written,
    release() {
      draining = true;
      for (const complete of held.splice(0)) {
        complete();
      }
    },
  };
}

function makeSystemError(code: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`write ${code}`);
  error.code = code;
  return error;
}

/** A writable whose every write fails with the given system error code. */
function makeFailingStream(code: string): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback(makeSystemError(code));
    },
  });
}

describe("watchStream", () => {
  it("flushes only once every queued write reached the stream", async () => {
    const held = makeHeldStream();
    const watched = watchStream(held.stream);
    held.stream.write("first");
    held.stream.write("second");
    let settled = false;

    const flushed = watched.flush().then((outcome) => {
      settled = true;
      return outcome;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    held.release();

    expect(await flushed).toBe(StreamOutcomes.FLUSHED);
    expect(held.written.join("")).toBe("firstsecond");
  });

  it.each(["EPIPE", "ECONNRESET"])(
    "reports a %s on flush as the reader closing",
    async (code) => {
      const stream = makeFailingStream(code);
      const watched = watchStream(stream);
      stream.write("lost");

      expect(await watched.flush()).toBe(StreamOutcomes.READER_CLOSED);
    },
  );

  it("reports any other write error as failed", async () => {
    const stream = makeFailingStream("EIO");
    const watched = watchStream(stream);
    stream.write("lost");

    expect(await watched.flush()).toBe(StreamOutcomes.FAILED);
  });

  it("keeps an error raised before the flush instead of crashing", async () => {
    const stream = new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    });
    const watched = watchStream(stream);

    stream.destroy(makeSystemError("EPIPE"));
    await new Promise((resolve) => setImmediate(resolve));

    expect(await watched.flush()).toBe(StreamOutcomes.READER_CLOSED);
  });
});

describe("resolveExitCode", () => {
  it("keeps the command's code while stdout flushed or the reader left", () => {
    expect(resolveExitCode(ExitCodes.OK, StreamOutcomes.FLUSHED)).toBe(
      ExitCodes.OK,
    );
    expect(resolveExitCode(ExitCodes.OK, StreamOutcomes.READER_CLOSED)).toBe(
      ExitCodes.OK,
    );
    expect(
      resolveExitCode(ExitCodes.NOT_FOUND, StreamOutcomes.READER_CLOSED),
    ).toBe(ExitCodes.NOT_FOUND);
  });

  it("fails a successful command whose stdout failed", () => {
    expect(resolveExitCode(ExitCodes.OK, StreamOutcomes.FAILED)).toBe(
      ExitCodes.GENERIC,
    );
  });

  it("keeps a failed command's own code when stdout also failed", () => {
    expect(resolveExitCode(ExitCodes.AUTH, StreamOutcomes.FAILED)).toBe(
      ExitCodes.AUTH,
    );
  });
});

const SKEW_NOTICE = "mergebrief 1.0.0 is behind this server (2.0.0)";
const UPDATE_NAG = "mergebrief 1.1.0 is available";

/** A writable that takes every write at once. */
function makeOpenStream(): Writable {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
}

/** A run ending whose stderr lines land in `held`, nag offered only on success. */
function makeRunEnding(
  code: number,
  stdout: Writable,
  held: HeldStream,
): RunEnding {
  return {
    code,
    stdout: watchStream(stdout),
    stderr: watchStream(held.stream),
    writeStderr: (line) => held.stream.write(`${line}\n`),
    successNotices: [SKEW_NOTICE],
    settleUpdateNag: (succeeded) => (succeeded ? UPDATE_NAG : undefined),
  };
}

describe("resolveFinalExitCode", () => {
  it("prints held notices and the nag after a run that flushed", async () => {
    const held = makeHeldStream();
    held.release();

    const ending = makeRunEnding(ExitCodes.OK, makeOpenStream(), held);
    const exitCode = await resolveFinalExitCode(ending);

    expect(exitCode).toBe(ExitCodes.OK);
    expect(held.written.join("")).toBe(`${SKEW_NOTICE}\n${UPDATE_NAG}\n`);
  });

  it("prints one line and no notice when stdout lost the output", async () => {
    const held = makeHeldStream();
    held.release();
    const stdout = makeFailingStream("EIO");
    const ending = makeRunEnding(ExitCodes.OK, stdout, held);
    stdout.write("lost");

    const exitCode = await resolveFinalExitCode(ending);

    expect(exitCode).toBe(ExitCodes.GENERIC);
    expect(held.written.join("")).toBe(
      "could not write the whole output to stdout\n",
    );
  });

  it("adds nothing to a failed command's own error line", async () => {
    const held = makeHeldStream();
    held.release();
    const stdout = makeFailingStream("EPIPE");
    const ending = makeRunEnding(ExitCodes.NOT_FOUND, stdout, held);
    stdout.write("lost");

    const exitCode = await resolveFinalExitCode(ending);

    expect(exitCode).toBe(ExitCodes.NOT_FOUND);
    expect(held.written.join("")).toBe("");
  });

  it("resolves only once stderr took its last line", async () => {
    const held = makeHeldStream();
    let settled = false;

    const ending = makeRunEnding(ExitCodes.OK, makeOpenStream(), held);
    const resolved = resolveFinalExitCode(ending).then((exitCode) => {
      settled = true;
      return exitCode;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    held.release();

    expect(await resolved).toBe(ExitCodes.OK);
  });
});
