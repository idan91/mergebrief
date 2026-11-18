/**
 * One Brief's write epoch and in-flight count. A write moves the epoch when
 * it starts and again when it settles, so a read is current only when the
 * epoch it began at is still the epoch now and nothing is in flight.
 */
export interface SessionLedger {
  startRead(): void;
  isReadCurrent(): boolean;
  hasPendingWrite(): boolean;
  trackWrite<Value>(write: () => Promise<Value>): Promise<Value>;
  /**
   * A landed read was dropped. Asks for one new read once nothing is in
   * flight: at once when the writes already settled, otherwise when the
   * last one does. Drops before that ask share it.
   */
  dropRead(): void;
  subscribeReadRequests(listener: () => void): () => void;
}

export function createSessionLedger(): SessionLedger {
  let epoch = 0;
  let readEpoch = 0;
  let inFlight = 0;
  let readWanted = false;
  const readRequestListeners = new Set<() => void>();

  function requestReadIfSettled(): void {
    const settled = readWanted && inFlight === 0;
    if (!settled) {
      return;
    }
    readWanted = false;
    for (const listener of readRequestListeners) {
      listener();
    }
  }

  return {
    startRead() {
      readEpoch = epoch;
    },
    isReadCurrent() {
      const current = inFlight === 0 && readEpoch === epoch;
      return current;
    },
    hasPendingWrite() {
      return inFlight > 0;
    },
    async trackWrite(write) {
      epoch += 1;
      inFlight += 1;
      try {
        return await write();
      } finally {
        inFlight -= 1;
        epoch += 1;
        requestReadIfSettled();
      }
    },
    dropRead() {
      readWanted = true;
      requestReadIfSettled();
    },
    subscribeReadRequests(listener) {
      readRequestListeners.add(listener);
      return () => {
        readRequestListeners.delete(listener);
      };
    },
  };
}
