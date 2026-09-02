import type { ContextSnippet } from "../context/types";
import { type PrLifecycleState, type ReviewComment } from "../types";

export type { ReviewComment };

export interface PrLocator {
  owner: string;
  repo: string;
  number: number;
}

export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
}

export interface PrMetadata {
  title: string;
  body: string;
  url: string;
  sha: string;
  /** PR base commit SHA — the start of the whole-PR commit range. */
  baseSha: string;
  /** Number of commits in the PR at this head. */
  commitCount: number;
  /** Head branch name; absent on older fetch paths and artifacts. */
  headRef?: string;
  files: PrFile[];
  /**
   * PR lifecycle snapshot at fetch time, stamped into the artifact envelope's
   * `pr` block. Optional end to end: older fetch paths and artifacts omit them.
   */
  state?: PrLifecycleState;
  draft?: boolean;
  merged?: boolean;
}

export interface FetchedPr {
  locator: PrLocator;
  meta: PrMetadata;
  diff: string;
  /** Untrusted reference text the context providers fetched. Best-effort. */
  links: ContextSnippet[];
}

/** Minimal logger — structural so callers (CLI) can pass a tagged sink. */
export type Log = (message: string) => void;
