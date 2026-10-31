import { fork } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { LockfileSides } from "brief-core/shortened";
import type { Result } from "types/utils";
import { SummaryReplySchema } from "./schemas";
import {
  SummaryFailures,
  type ChildLimits,
  type SummaryFailure,
  type SummaryReply,
  type SummaryRequest,
} from "./types";

const CHILD_ENTRY = fileURLToPath(
  new URL("./summary-child.ts", import.meta.url),
);
const TSX_LOADER = createRequire(import.meta.url).resolve("tsx");
/** A realistic side pair near the byte cap parses within 384 MB. */
const CHILD_HEAP_MB = 512;
const CHILD_SEMI_SPACE_MB = 16;
/**
 * The child's own flags, never the parent's: a process-wide
 * `--max-old-space-size` in `NODE_OPTIONS` would lift a thread's heap cap,
 * so the parse runs in a process whose cap and empty environment it sets.
 */
const CHILD_EXEC_ARGV = [
  "--import",
  TSX_LOADER,
  `--max-old-space-size=${CHILD_HEAP_MB}`,
  `--max-semi-space-size=${CHILD_SEMI_SPACE_MB}`,
];

type SummaryOutcome = Result<SummaryReply, SummaryFailure>;

const CRASHED: SummaryOutcome = { ok: false, error: SummaryFailures.CRASHED };
const STOPPED: SummaryOutcome = { ok: false, error: SummaryFailures.STOPPED };
const TIMED_OUT: SummaryOutcome = {
  ok: false,
  error: SummaryFailures.TIMED_OUT,
};

function readReply(message: unknown): SummaryOutcome {
  const reply = SummaryReplySchema.safeParse(message);
  return reply.success
    ? { ok: true, value: reply.data }
    : { ok: false, error: SummaryFailures.MALFORMED_REPLY };
}

/**
 * One lockfile's summary, read in a child process under a heap cap and a
 * deadline, so no lockfile text can exhaust the worker's heap or hold its
 * event loop. The child gets no environment: it parses untrusted text and
 * needs no configuration. Whichever comes first, its reply, its close or
 * the deadline, decides; the child is killed either way. Its close, never
 * its exit: `exit` can fire while the channel still holds the reply.
 */
export async function summarizeInChild(
  path: string,
  sides: LockfileSides,
  limits: ChildLimits,
): Promise<SummaryOutcome> {
  if (limits.stop.aborted) {
    return STOPPED;
  }
  const request: SummaryRequest = { path, sides };
  const child = fork(CHILD_ENTRY, {
    execArgv: CHILD_EXEC_ARGV,
    env: {},
    serialization: "advanced",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const deadline = new AbortController();

  // `once` rejects on the child's `error` event, which reads as a crash.
  const replied = once(child, "message").then(
    ([message]: unknown[]) => readReply(message),
    () => CRASHED,
  );
  const closed = once(child, "close").then(
    () => CRASHED,
    () => CRASHED,
  );
  const timedOut = sleep(limits.timeoutMs, TIMED_OUT, {
    signal: deadline.signal,
  }).catch(() => TIMED_OUT);
  const stopped = once(limits.stop, "abort", { signal: deadline.signal }).then(
    () => STOPPED,
    () => STOPPED,
  );
  try {
    child.send(request);
    return await Promise.race([replied, closed, timedOut, stopped]);
  } catch {
    return CRASHED;
  } finally {
    deadline.abort();
    child.kill("SIGKILL");
  }
}
