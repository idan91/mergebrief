import type { ValueOf } from "./utils";

/** Values of `MERGEBRIEF_RUNTIME`, the marker the shipped image bakes so a
 * process knows it runs inside the container and not from a checkout. */
export const Runtimes = {
  COMPOSE_WORKER: "compose-worker",
} as const;
export type Runtime = ValueOf<typeof Runtimes>;
