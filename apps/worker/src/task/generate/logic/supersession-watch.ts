import type { Generator } from "generators";
import type { PullRequestInfo } from "github";
import { GenerationErrorCodes, type GenerationError } from "persistence";
import type { Result } from "types/utils";
import type { PullRequestSource } from "../../github-port";
import type { ClaimRenewer, SupersessionWatch } from "../types";

/** Control-flow signal: the job's head is no longer the PR's head. */
export class SupersededSignal extends Error {}

/** Control-flow signal: another run holds the row this run claimed. */
export class ClaimLostSignal extends Error {}

/** A fenced write the store refused because another run holds the row. */
export function throwOnClaimLost(
  written: Result<unknown, GenerationError>,
): void {
  if (!written.ok && written.error.code === GenerationErrorCodes.CLAIM_LOST) {
    throw new ClaimLostSignal("another run holds the generation row");
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
    const info = await source.fetchPullRequest();
    if (!info.ok || info.value.headSha === headSha) {
      return false;
    }
    // Retained so the supersession does not have to re-read GitHub to learn
    // the head it is standing down for.
    seen = info.value;
    return true;
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
      const reason: unknown = controller.signal.reason;
      if (reason instanceof ClaimLostSignal) {
        throw reason;
      }
      let moved = false;
      try {
        moved = await hasHeadMoved();
      } catch {
        // Best-effort check; a fetch failure is not a supersession.
      }
      if (moved) {
        controller.abort();
        throw new SupersededSignal("head advanced (pre-call check)");
      }
    },
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

/** Wrap a Generator so every request carries the watch's abort signal. */
export function bindAbortSignal(
  generator: Generator,
  signal: AbortSignal,
): Generator {
  return {
    generate: (req) => generator.generate({ ...req, signal }),
    origin: (effort) => generator.origin(effort),
  };
}
