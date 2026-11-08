import type { BriefSpanRow } from "persistence";
import {
  GenerationStatuses,
  type GenerationFailureCode,
} from "types/generations";
import {
  buildEntryCommentFailedBody,
  isHeadEntryBody,
  isOpenHeadEntryBody,
} from "../../entry-comment";
import {
  EntryWrites,
  HeadReadings,
  type EntryWrite,
  type RunContext,
  type RunProgress,
  type RunScope,
} from "../types";
import { deriveNextHeadIndex } from "../utils";
import { resolveRunEntryCommentAllowed } from "./entry-comment-gate";
import { queueEntrySyncOnLostWrite } from "./entry-sync";
import { replaceOnUnreadHead } from "./unread-head-entry";

/**
 * The failed Entry, once this head's run ended `failed` for good. It replaces
 * this head's generating, capped or failed body; once the run read the PR
 * open and its head, also the on-demand or closed body, or creates the comment
 * under the Entry gate. Any other live body stays, and a stored brief keeps
 * its ready body. Before that read the gate is unknown, so it only replaces.
 * A moved head leaves the comment to the newer head's run, and an unread one
 * only replaces a body that names this head. The sync queued ahead of the
 * failed write may have run, so a lost post queues it again.
 */
export async function postFailedEntry(
  progress: RunProgress,
  code: GenerationFailureCode,
  options: FailedEntryOptions = {},
): Promise<void> {
  const { scope, context } = progress;
  if (scope === undefined || scope.payload.grantId !== undefined) {
    return;
  }

  try {
    const write =
      context === undefined
        ? await replaceFailedBody(scope, code)
        : await replaceOrCreateFailedBody(context, code, options);
    await queueEntrySyncOnLostWrite(scope, write);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scope.log.warn(
      `generate: failed entry comment skipped (job unaffected) — ${message}`,
    );
  }
}

export interface FailedEntryOptions {
  /** The post stands down unless the row, read after the head, still fails with `code`. */
  readonly requiresFailedRow?: boolean;
}

async function replaceOrCreateFailedBody(
  context: RunContext,
  code: GenerationFailureCode,
  options: FailedEntryOptions,
): Promise<EntryWrite> {
  if (await isBriefStored(context)) {
    return EntryWrites.LEFT;
  }
  if (!(await resolveRunEntryCommentAllowed(context))) {
    return EntryWrites.LEFT;
  }
  const head = await context.watch.readHead();
  if (head.kind === HeadReadings.MOVED) {
    context.log.info("generate: head moved, leaving the Entry comment to it");
    return EntryWrites.LEFT;
  }
  const rowMoved =
    options.requiresFailedRow === true &&
    !(await isRowStillFailed(context, code));
  if (rowMoved) {
    context.log.info(
      "generate: the row left its failure, the failed Entry stands down",
    );
    return EntryWrites.LEFT;
  }

  const failedBody = buildFailedEntryBody(context, code, context.priorBriefs);
  if (head.kind === HeadReadings.UNREAD) {
    const post = {
      entryCommentManager: context.entryCommentManager,
      headSha: context.payload.headSha,
      log: context.log,
    };
    return replaceOnUnreadHead(post, failedBody, head);
  }
  const { headSha } = context.payload;
  return context.entryCommentManager.replaceOrCreate(failedBody, (live) =>
    isOpenHeadEntryBody(live, headSha),
  );
}

async function replaceFailedBody(
  scope: RunScope,
  code: GenerationFailureCode,
): Promise<EntryWrite> {
  const { payload, store } = scope;
  const priorBriefs = await store.briefs.listForPullRequest(
    payload.pullRequestId,
  );
  if (priorBriefs.some((row) => row.headSha === payload.headSha)) {
    return EntryWrites.LEFT;
  }

  const failedBody = buildFailedEntryBody(scope, code, priorBriefs);
  return scope.entryCommentManager.replace(failedBody, (live) =>
    isHeadEntryBody(live, payload.headSha),
  );
}

function buildFailedEntryBody(
  scope: RunScope,
  code: GenerationFailureCode,
  priorBriefs: readonly BriefSpanRow[],
): string {
  const { deps, entryCommentManager } = scope;
  const headLink = entryCommentManager.buildDeepLink(
    deriveNextHeadIndex(priorBriefs),
  );
  return buildEntryCommentFailedBody(deps.translate, headLink, code);
}

/** A trigger may have projected the row afresh since the run ended it. */
async function isRowStillFailed(
  context: RunContext,
  code: GenerationFailureCode,
): Promise<boolean> {
  const row = await context.projection.get(context.target);
  const stillFailed =
    row?.status === GenerationStatuses.FAILED && row.errorCode === code;
  return stillFailed;
}

/** The brief may have landed during this run, after the context was read. */
async function isBriefStored(context: RunContext): Promise<boolean> {
  const { payload, prInfo, store, existingBrief } = context;
  if (existingBrief !== undefined) {
    return true;
  }

  const briefs = await store.briefs.listForPullRequest(payload.pullRequestId);
  return briefs.some((row) => {
    const sameSpan =
      row.baseSha === prInfo.baseSha && row.headSha === payload.headSha;
    return sameSpan;
  });
}
