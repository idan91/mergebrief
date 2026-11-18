/** A signal no test aborts: a read or a wait that runs to its own end. */
export function makeNeverAbortingSignal(): AbortSignal {
  return new AbortController().signal;
}
