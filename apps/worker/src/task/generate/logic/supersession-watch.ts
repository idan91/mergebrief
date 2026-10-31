import type { Generator } from "generators";
import type { PullRequestInfo } from "github";
import type { GenerationError } from "persistence";
import type { Result } from "types/utils";
import type { PullRequestSource } from "../../github-port";
import { ClaimLostSignal, SupersededSignal } from "./run-signals";
import {
  HeadReadings,
  type ClaimRenewer,
  type EntryPostHeadRead,
  type HeadRead,
  type SupersessionWatch,
} from "../types";

/** A claim write the store refused: another run holds the row, or it is gone. */
export function throwOnClaimLost(
  written: Result<unknown, GenerationError>,
): void {
  if (!written.ok) {
    throw new ClaimLostSignal(written.error.message);
  }
}

export function createSupersessionWatch(
  source: PullRequestSource,
  headSha: string,
  intervalMs: number,
  renewClaim: ClaimRenewer,
): SupersessionWatch {
  const controller = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  let polling = false;
  let renewing = false;
  let seen: PullRequestInfo | undefined;

  async function hasHeadMoved(): Promise<boolean> {
    const read = await fetchHead();
    return read.kind === HeadReadings.MOVED;
  }

  async function fetchHead(): Promise<HeadRead> {
    const info = await source.fetchPullRequest();
    if (!info.ok) {
      return { kind: HeadReadings.UNREAD, error: info.error.message };
    }
    if (info.value.headSha === headSha) {
      return { kind: HeadReadings.CURRENT };
    }
    // Retained so the supersession does not have to re-read GitHub to learn
    // the head it is standing down for.
    seen = info.value;
    return { kind: HeadReadings.MOVED };
  }

  async function readHead(): Promise<HeadRead> {
    const reason: unknown = controller.signal.reason;
    if (reason instanceof ClaimLostSignal) {
      throw reason;
    }
    let read: HeadRead;
    try {
      read = await fetchHead();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      read = { kind: HeadReadings.UNREAD, error: message };
    }
    if (read.kind === HeadReadings.MOVED) {
      controller.abort();
    }
    return read;
  }

  async function keepClaim(): Promise<void> {
    try {
      const kept = await renewClaim();
      if (!kept) {
        controller.abort(new ClaimLostSignal("claim lost on the head check"));
      }
    } catch {
      // A failed renewal is retried next tick; several fit in one lease.
    } finally {
      renewing = false;
    }
  }

  async function pollOnce(): Promise<void> {
    try {
      if (await hasHeadMoved()) {
        controller.abort();
      }
    } catch {
      // Poll failures are ignored, the pre-call checks still stand.
    } finally {
      polling = false;
    }
  }

  // Renewal runs apart from the head read: a stalled GitHub call must not
  // starve the lease past its expiry.
  function tick(): void {
    if (controller.signal.aborted) {
      return;
    }
    if (!renewing) {
      renewing = true;
      void keepClaim();
    }
    if (!polling) {
      polling = true;
      void pollOnce();
    }
  }

  return {
    signal: controller.signal,
    getObserved() {
      return seen;
    },
    async assertCurrent() {
      // Best-effort: an unread head is not a supersession.
      const read = await readHead();
      if (read.kind === HeadReadings.MOVED) {
        throw new SupersededSignal("head advanced (pre-call check)");
      }
    },
    readHead,
    startPolling() {
      timer ??= setInterval(tick, intervalMs);
    },
    stop() {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}

/** The head a run going on posts its Entry on: a moved one throws `SupersededSignal`. */
export async function readEntryPostHead(
  watch: Pick<SupersessionWatch, "readHead">,
): Promise<EntryPostHeadRead> {
  const read = await watch.readHead();
  if (read.kind === HeadReadings.MOVED) {
    throw new SupersededSignal("head advanced (pre-post check)");
  }
  return read;
}

/**
 * Wrap a Generator so every request also aborts on the watch's signal; a
 * request's own signal, when it carries one, still aborts it.
 */
export function bindAbortSignal(
  generator: Generator,
  signal: AbortSignal,
): Generator {
  return {
    generate(req) {
      const combined =
        req.signal === undefined
          ? signal
          : AbortSignal.any([req.signal, signal]);
      return generator.generate({ ...req, signal: combined });
    },
    origin: (effort) => generator.origin(effort),
  };
}
