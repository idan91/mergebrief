import { GenerationStatuses } from "types/generations";
import type { UnmetCondition } from "types/trigger-conditions";
import {
  buildEntryCommentHeldBody,
  isHeadClosedEntryBody,
} from "../../../entry-comment";
import type { AcquiredRepoConfig } from "../../../repo-config";
import { EntryWrites, HeadReadings, type RunContext } from "../../types";
import { buildHeldEntryLinks } from "../../utils";
import { resolveEntryCommentAllowed } from "../entry-comment-gate";
import { queueEntrySync, queueEntrySyncOnLostWrite } from "../entry-sync";

/**
 * The held head's Entry, written by a silent edit, or posted once when the
 * thread has none: a hold never pings, and a live body a re-check matches
 * stays. The row is read again before the write, since a click may release
 * the head meanwhile, and a newer head's thread is left to it. This head's
 * closed body may have landed since the PR read, so the write leaves it and
 * queues the head's sync, which reads the PR fresh, as a failed post or one
 * that stands down on an unread head does.
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
  if (await entryCommentManager.matches(body)) {
    log.info("generate: held entry already live, left as it is");
    return;
  }
  const current = await context.projection.get(context.target);
  if (current?.status !== GenerationStatuses.HELD) {
    log.info("generate: head left held, held entry skipped");
    return;
  }
  const head = await context.watch.readHead();
  if (head.kind === HeadReadings.MOVED) {
    log.info("generate: head moved, leaving the Entry comment to it");
    return;
  }
  if (head.kind === HeadReadings.UNREAD) {
    log.warn("generate: head unread, the held Entry stands down", {
      error: head.error,
    });
    await queueEntrySync(context);
    return;
  }

  const { headSha } = context.target;
  const write = await entryCommentManager.editOrCreate(
    body,
    (live) => !isHeadClosedEntryBody(live, headSha),
  );
  if (write === EntryWrites.LEFT) {
    await queueEntrySync(context);
    return;
  }
  await queueEntrySyncOnLostWrite(context, write);
}
