import type { PrLocator, PrMetadata } from "brief-core";
import type { ReviewComment } from "brief-core/types";
import { fetchReviewComments } from "./comments";
import {
  fetchCompareCommitCount,
  fetchCompareDiff,
  fetchPrDiff,
  fetchPrMetadata,
  resolveFullSha,
} from "./fetch";

/**
 * The PR-read port: everything `buildInputs` needs to assemble a brief's inputs,
 * abstracted from transport. `ghPrSource` (gh CLI) is the default. The context
 * providers stay off the port: they are their own boundary with their own
 * credentials.
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
