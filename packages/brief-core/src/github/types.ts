import { type ReviewComment } from "../types";

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
  /** PR base commit SHA — the start of the whole-PR commit range (ADR 0012). */
  baseSha: string;
  /** Number of commits in the PR at this head. */
  commitCount: number;
  files: PrFile[];
}

/** Text fetched from a URL found in the PR description. Best-effort context. */
export interface LinkedContext {
  url: string;
  content: string;
}

export interface FetchedPr {
  locator: PrLocator;
  meta: PrMetadata;
  diff: string;
  links: LinkedContext[];
}

/** Minimal logger — structural so callers (CLI) can pass a tagged sink. */
export type Log = (message: string) => void;
