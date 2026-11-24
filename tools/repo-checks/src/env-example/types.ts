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
  /** Server sources that read the environment but are neither parsers nor skipped. */
  readonly unlistedReaders: readonly string[];
  /** Skipped sources that no longer mention the environment. */
  readonly staleReaderSkips: readonly string[];
}

export interface EnvReaderInput {
  readonly readers: readonly string[];
  readonly parsers: readonly string[];
  readonly skips: ReadonlyMap<string, string>;
}

export interface EnvReaderGaps {
  readonly unlisted: readonly string[];
  readonly staleSkips: readonly string[];
}

export interface EnvExampleInput {
  readonly parsers: readonly TrackedText[];
  readonly example: string;
  /** Keys read on purpose without an example line, with the reason. */
  readonly exemptions: ReadonlyMap<string, string>;
}
