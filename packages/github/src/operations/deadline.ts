/** A webhook delivery waits on these reads; two in a row still fit GitHub's 10s budget. */
export const CONFIRMATION_READ_TIMEOUT_MS = 4_000;

/** Reject once the deadline passes, whether or not the read honoured the signal. */
export async function runWithinDeadline<Value>(
  read: (signal: AbortSignal) => Promise<Value>,
  timeoutMs: number,
): Promise<Value> {
  const signal = AbortSignal.timeout(timeoutMs);
  const deadline = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
  return Promise.race([read(signal), deadline]);
}
