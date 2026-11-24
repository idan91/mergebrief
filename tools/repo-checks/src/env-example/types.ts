import type { TrackedText } from "../types";

export interface EnvKeyGap {
  readonly key: string;
  /** The parser files that read the key. */
  readonly paths: readonly string[];
}

export interface EnvExampleGaps {
  readonly missing: readonly EnvKeyGap[];
  /** Exempted keys no parser reads any more. */
  readonly staleExemptions: readonly string[];
}

export interface EnvExampleInput {
  readonly parsers: readonly TrackedText[];
  readonly example: string;
  /** Keys read on purpose without an example line, with the reason. */
  readonly exemptions: ReadonlyMap<string, string>;
}
