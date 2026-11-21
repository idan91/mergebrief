import { GenerationStatuses } from "types/generations";
import type { UnmetCondition } from "types/trigger-conditions";
import {
  buildEntryCommentHeldBody,
  isEntryCommentBody,
  isHeadClosedEntryBody,
} from "../../../entry-comment";
import { EntryBodyKinds } from "../../../entry-comment/types";
import type { AcquiredRepoConfig } from "../../../repo-config";
import {
  EntryWrites,
  type LiveBodyMatcher,
  type RunContext,
} from "../../types";
import { buildHeldEntryLinks } from "../../utils";
import { resolveEntryCommentAllowed } from "../entry-comment-gate";
import { queueEntrySync, queueSyncAfterLandedWrite } from "../entry-sync";
import { postStatusEntry } from "../status-entry";

/**
 * The held head's Entry: an existing comment is edited in place, so nobody
 * is notified again, and a thread with none gets one posted. A body with no
 * MergeBrief marker is left, as the Entry sync leaves it. This head's
 * closed body may have landed since the PR read, so the write leaves it and
 * queues the head's sync, which reads the PR fresh. The row and head checks
 * are `postStatusEntry`'s.
 */
export async function postHeldEntry(
  context: RunContext,
  repoConfig: AcquiredRepoConfig,
  unmet: readonly UnmetCondition[],
): Promise<void> {
  const { deps, payload, prInfo, priorBriefs, entryCommentManager, log } =
    context;
  const allowed = await resolveEntryCommentAllowed(payload, {
    prInfo,
    repoConfig,
    entryCommentManager,
    log,
  });
  if (!allowed) {
    return;
  }

  const links = buildHeldEntryLinks(entryCommentManager, priorBriefs);
  const body = buildEntryCommentHeldBody(deps.translate, { ...links, unmet });
  const { headSha } = context.target;
  const isEditable: LiveBodyMatcher = (live) => {
    const editable =
      isEntryCommentBody(live) && !isHeadClosedEntryBody(live, headSha);
    return editable;
  };
  const landedWriteCheck = {
    watch: context.watch,
    headSha,
    queueEntrySync: (syncHeadSha: string) =>
      queueEntrySync(context, syncHeadSha),
  };
  await postStatusEntry(context, {
    body,
    status: GenerationStatuses.HELD,
    label: EntryBodyKinds.HELD,
    async write(held) {
      const written = await entryCommentManager.editOrCreate(held, isEditable);
      if (written === EntryWrites.LEFT) {
        await queueEntrySync(context);
      }
      await queueSyncAfterLandedWrite(landedWriteCheck, written);
      return written;
    },
  });
}
