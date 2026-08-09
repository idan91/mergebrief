import { fetchReviewComments } from "./comments";
import {
  fetchCompareCommitCount,
  fetchCompareDiff,
  fetchPrDiff,
  fetchPrMetadata,
  resolveFullSha,
} from "./fetch";
import type { PrLocator, PrMetadata, ReviewComment } from "./types";

/**
 * The PR-read port: everything `buildInputs` needs to assemble a brief's inputs,
 * abstracted from transport. `ghPrSource` (gh CLI) is the default; the web tier
 * injects an octokit-backed source authenticated as the signed-in viewer, which
 * is how the URL box works where no gh binary exists.
 *
 * Deliberately NOT in the port: `fetchLinkedContext` (plain HTTP, no GitHub auth
 * involved) and `parsePrUrl`/`isCommitish` (pure).
 */
export interface PrSource {
  fetchPrMetadata(loc: PrLocator): Promise<PrMetadata>;
  fetchPrDiff(loc: PrLocator): Promise<string>;
  fetchCompareDiff(
    loc: PrLocator,
    baseSha: string,
    headSha: string,
  ): Promise<string>;
  fetchReviewComments(loc: PrLocator): Promise<ReviewComment[]>;
  fetchCompareCommitCount(
    loc: PrLocator,
    baseSha: string,
    headSha: string,
  ): Promise<number>;
  resolveFullSha(loc: PrLocator, ref: string): Promise<string>;
}

export const ghPrSource: PrSource = {
  fetchPrMetadata,
  fetchPrDiff,
  fetchCompareDiff,
  fetchReviewComments,
  fetchCompareCommitCount,
  resolveFullSha,
};
