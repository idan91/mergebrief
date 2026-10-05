import type { Result } from "types";

export interface Semver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
}

/** A `SERVER_VERSION` value, or why it cannot ride a response header. */
export type ServerVersionResult = Result<string, string>;
