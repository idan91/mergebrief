import type { Generator } from "generators";
import type { PullRequestInfo } from "github";
import type { PullRequestSource } from "../../github-port";
import type { SupersessionWatch } from "../types";

/** Control-flow signal: the job's head is no longer the PR's head. */
export class SupersededSignal extends Error {}

export function createSupersessionWatch(
  source: PullRequestSource,
  headSha: string,
  intervalMs: number,
): SupersessionWatch {
  const controller = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined;
  let polling = false;
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

  return {
    signal: controller.signal,
    getObserved() {
      return seen;
    },
    async assertCurrent() {
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
      timer ??= setInterval(() => {
        if (polling || controller.signal.aborted) {
          return;
        }
        polling = true;
        void pollOnce();
      }, intervalMs);
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
