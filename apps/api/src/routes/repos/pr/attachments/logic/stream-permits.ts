import type { StreamPermit, StreamPermits } from "../types";

/** A counter of open media streams for one process; past `limit` it opens none. */
export function createStreamPermits(limit: number): StreamPermits {
  let open = 0;

  function acquire(): StreamPermit | undefined {
    if (open >= limit) {
      return undefined;
    }
    open += 1;
    let released = false;
    return {
      release() {
        if (released) {
          return;
        }
        released = true;
        open -= 1;
      },
    };
  }

  return { acquire, countOpen: () => open };
}
