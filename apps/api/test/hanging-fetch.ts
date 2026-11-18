import { vi, type Mock } from "vitest";

/** A fetch held open by the test: answered when it says, rejected on abort. */
export interface HangingFetch {
  readonly fetchImpl: Mock<
    (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  >;
  readonly answer: (response: Response) => void;
  readonly readSignal: () => AbortSignal | undefined;
}

/** A fetch whose answer waits until `answer` is called, and rejects on abort as fetch does. */
export function makeHangingFetch(): HangingFetch {
  let seenSignal: AbortSignal | undefined;
  let answer: (response: Response) => void = () => undefined;
  const fetchImpl = vi.fn(
    (_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        seenSignal = init?.signal ?? undefined;
        answer = resolve;
        seenSignal?.addEventListener("abort", () => {
          reject(seenSignal?.reason);
        });
      }),
  );
  return {
    fetchImpl,
    answer: (response: Response) => answer(response),
    readSignal: () => seenSignal,
  };
}
