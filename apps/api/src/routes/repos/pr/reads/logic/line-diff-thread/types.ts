import type { LineDiffInput } from "brief-core/pr-span";
import type { ValueOf } from "types/utils";

export const LineDiffAnswerKinds = {
  PATCH: "patch",
  /** A bound sent the file to its fallback. */
  NO_PATCH: "no-patch",
} as const;
/** @public */
export type LineDiffAnswerKind = ValueOf<typeof LineDiffAnswerKinds>;

/** One file's line diff posted to the thread. */
export interface LineDiffRequest {
  readonly id: number;
  readonly input: LineDiffInput;
}

/** The thread's answer to the request carrying the same id. */
export type LineDiffAnswer =
  | {
      readonly id: number;
      readonly kind: typeof LineDiffAnswerKinds.PATCH;
      readonly patch: string;
    }
  | { readonly id: number; readonly kind: typeof LineDiffAnswerKinds.NO_PATCH };

export interface LineDiffThreadOptions {
  /** The thread's module; tests point it at a stand-in. */
  readonly entry?: URL;
  /** How long one diff may go unanswered before the thread is stopped as stuck. */
  readonly answerLimitMs?: number;
  /** The wait before a restart after the second stop in a row, doubling per further stop. */
  readonly respawnBackoffMs?: number;
}
