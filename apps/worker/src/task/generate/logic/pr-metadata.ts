import { attachPrStack, toPrLifecycleState, type PrMetadata } from "brief-core";
import type { PrMetadataInputs } from "../types";

/** The PR metadata every core reads, with the stack attached when the open list came back. */
export function buildPrMetadata(inputs: PrMetadataInputs): PrMetadata {
  const { prInfo, files, prRow, openPullRequests, log } = inputs;

  const state = toPrLifecycleState(prInfo.state);
  const meta: PrMetadata = {
    title: prInfo.title,
    body: prInfo.body,
    url: prInfo.htmlUrl,
    sha: prInfo.headSha,
    baseSha: prInfo.baseSha,
    commitCount: prInfo.commitCount,
    headRef: prInfo.headRef,
    files,
    draft: prInfo.draft,
    merged: prInfo.merged,
  };

  if (state !== undefined) meta.state = state;
  if (prInfo.baseRef !== undefined) meta.baseRef = prInfo.baseRef;
  if (prInfo.headRepo !== undefined) meta.headRepo = prInfo.headRepo;
  if (prInfo.baseRepo !== undefined) meta.baseRepo = prInfo.baseRepo;
  if (!openPullRequests.ok) {
    log.warn("generate: open pull request list failed", {
      code: openPullRequests.error.code,
      status: openPullRequests.error.status,
    });
  } else {
    attachPrStack(meta, prRow.prNumber, openPullRequests.value);
  }

  return meta;
}
