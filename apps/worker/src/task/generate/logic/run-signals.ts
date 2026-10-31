/** Control-flow signal: the job's head is no longer the PR's head. */
export class SupersededSignal extends Error {}

/** Control-flow signal: the row this run claimed is another run's, or gone. */
export class ClaimLostSignal extends Error {}

/** Control-flow signal: the cap refused the run's claim, its first paid call, or a large run's units. */
export class SpendCappedSignal extends Error {}

/** The ends a run takes by design: a newer push, a lost claim, the cap. */
const RUN_SIGNALS = [SupersededSignal, ClaimLostSignal, SpendCappedSignal];

export function isRunSignal(error: unknown): boolean {
  return RUN_SIGNALS.some((signal) => error instanceof signal);
}
