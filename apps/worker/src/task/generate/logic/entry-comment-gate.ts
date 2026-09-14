import { RepoConfigOutcomes, RepoConfigPaths } from "repo-config";
import type { ParsedGeneratePayload } from "../../payload";
import type { EntryCommentGateInputs, ReadyEntryInputs } from "../types";

/**
 * Whether this run may post Entry comments. Url-box jobs never write to
 * GitHub. Drafts need the repo's opt-in; a known-off setting sweeps a
 * lingering comment, but a settings fetch failure never deletes one.
 */
export async function resolveEntryCommentAllowed(
  payload: ParsedGeneratePayload,
  inputs: EntryCommentGateInputs,
): Promise<boolean> {
  const { prInfo, repoConfig, entryCommentManager, log } = inputs;

  // Entry comments stay off drafts unless repo settings opt in; generation is independent.
  // The ready_for_review skip drain may later post the ready entry.
  const entryCommentAllowed =
    payload.grantId === undefined &&
    (!prInfo.draft || repoConfig?.settings?.entryCommentOnDrafts === true);
  if (!entryCommentAllowed && payload.grantId === undefined) {
    log.info(
      "generate: entry comment suppressed — draft PR without entryCommentOnDrafts",
    );
    // Delete lingering draft entries only when settings are known to disable them.
    // A settings fetch failure closes posting but cannot justify deleting a valid opt-in comment.
    const settingsUnknown =
      repoConfig?.files.some(
        (file) =>
          file.path === RepoConfigPaths.SETTINGS &&
          file.outcome === RepoConfigOutcomes.FETCH_FAILED,
      ) ?? false;
    if (!settingsUnknown) {
      await entryCommentManager.remove();
    }
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
