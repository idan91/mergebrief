import { RepoConfigOutcomes, RepoConfigPaths } from "repo-config";
import type { ParsedGeneratePayload } from "../../payload";
import type { EntryCommentGateInputs, ReadyEntryInputs } from "../types";

/**
 * Whether this run may post Entry comments. Url-box jobs never write to
 * GitHub. Drafts post unless the repo opts out with
 * `entryCommentOnDrafts: false`; an explicit off sweeps a lingering comment.
 * A settings fetch failure closes posting, since the repo's choice is
 * unknown, but never deletes a comment that choice may have allowed.
 */
export async function resolveEntryCommentAllowed(
  payload: ParsedGeneratePayload,
  inputs: EntryCommentGateInputs,
): Promise<boolean> {
  const { prInfo, repoConfig, entryCommentManager, log } = inputs;

  const optedOut = repoConfig?.settings?.entryCommentOnDrafts === false;
  const settingsUnknown =
    repoConfig?.files.some(
      (file) =>
        file.path === RepoConfigPaths.SETTINGS &&
        file.outcome === RepoConfigOutcomes.FETCH_FAILED,
    ) ?? false;
  const draftAllowed = !optedOut && !settingsUnknown;
  const entryCommentAllowed =
    payload.grantId === undefined && (!prInfo.draft || draftAllowed);

  if (!entryCommentAllowed && payload.grantId === undefined) {
    log.info(
      optedOut
        ? "generate: entry comment suppressed — draft PR with entryCommentOnDrafts off"
        : "generate: entry comment suppressed — draft PR with settings unreadable",
    );
    if (optedOut) await entryCommentManager.remove();
  }

  return entryCommentAllowed;
}

/**
 * Whether the ready Entry may post once the artifact exists. A draft run
 * that suppressed its Entry re-reads the PR here: a `ready_for_review` flip
 * during the run enqueues nothing for a running head, so this read is the
 * only way that flip reaches the thread. A failed read keeps the gate closed.
 */
export async function resolveReadyEntryAllowed(
  payload: ParsedGeneratePayload,
  inputs: ReadyEntryInputs,
): Promise<boolean> {
  const { prInfo, source, entryCommentAllowed, log } = inputs;
  if (entryCommentAllowed || payload.grantId !== undefined || !prInfo.draft) {
    return entryCommentAllowed;
  }

  const latest = await source.fetchPullRequest();
  const flipped = latest.ok && !latest.value.draft;
  if (flipped) {
    log.info("generate: draft flipped to ready during the run, posting Entry");
  }
  return flipped;
}
