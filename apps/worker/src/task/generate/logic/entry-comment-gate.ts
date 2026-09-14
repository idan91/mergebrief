import { RepoConfigOutcomes, RepoConfigPaths } from "repo-config";
import type { ParsedGeneratePayload } from "../../payload";
import type { EntryCommentGateInputs } from "../types";

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
