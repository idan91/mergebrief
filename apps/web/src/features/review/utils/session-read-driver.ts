import type {
  SessionReadListener,
  SessionReadSource,
} from "../session/provider";
import type { ReviewSessionPayload } from "../session/serverState";

export interface SessionReadDriver {
  source: SessionReadSource;
  startRead: () => void;
  landRead: (payload: ReviewSessionPayload) => void;
  hasPendingWrite: () => boolean;
  countReadRequests: () => number;
}

/** A session read source a test drives by hand, in place of the query cache. */
export function makeSessionReadDriver(): SessionReadDriver {
  const listeners = new Set<SessionReadListener>();
  let readRequests = 0;
  return {
    source: {
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      requestRead() {
        readRequests += 1;
      },
    },
    startRead: () => {
      for (const listener of listeners) {
        listener.startRead();
      }
    },
    landRead: (payload) => {
      for (const listener of listeners) {
        listener.landRead(payload);
      }
    },
    hasPendingWrite: () =>
      [...listeners].some((listener) => listener.hasPendingWrite()),
    countReadRequests: () => readRequests,
  };
}
