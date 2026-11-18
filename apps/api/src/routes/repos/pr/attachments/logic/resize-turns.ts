import type { ResizeTurn, ResizeTurns } from "../types";

type GrantTurn = (turn: ResizeTurn | undefined) => void;

/**
 * At most `limit` resizes run at once; a request past it waits in arrival
 * order for up to `maxWaitMs`, and with `maxWaiting` already waiting it is
 * refused at once, since each waiter holds an open upstream response.
 */
export function createResizeTurns(
  limit: number,
  maxWaitMs: number,
  maxWaiting: number,
): ResizeTurns {
  let running = 0;
  const waiting: GrantTurn[] = [];

  function openTurn(): ResizeTurn {
    let released = false;
    return {
      release() {
        if (released) {
          return;
        }
        released = true;
        const next = waiting.shift();
        if (next === undefined) {
          running -= 1;
          return;
        }
        next(openTurn());
      },
    };
  }

  function waitForTurn(signal: AbortSignal): Promise<ResizeTurn | undefined> {
    if (signal.aborted) {
      return Promise.resolve(undefined);
    }
    if (running < limit) {
      running += 1;
      return Promise.resolve(openTurn());
    }
    if (waiting.length >= maxWaiting) {
      return Promise.resolve(undefined);
    }

    const waiter = Promise.withResolvers<ResizeTurn | undefined>();
    const timer = setTimeout(giveUp, maxWaitMs);
    function settle(turn: ResizeTurn | undefined): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", giveUp);
      waiter.resolve(turn);
    }
    function giveUp(): void {
      const index = waiting.indexOf(settle);
      if (index !== -1) {
        waiting.splice(index, 1);
      }
      settle(undefined);
    }
    signal.addEventListener("abort", giveUp, { once: true });
    waiting.push(settle);
    return waiter.promise;
  }

  return {
    waitForTurn,
    countRunning: () => running,
    countWaiting: () => waiting.length,
  };
}
