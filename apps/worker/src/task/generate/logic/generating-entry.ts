import { buildEntryCommentGeneratingBody } from "../../entry-comment";
import {
  DEFAULT_DETAIL_CONCURRENCY,
  DETAIL_CALL_MINUTES,
  ESTIMATE_STEP_MINUTES,
  MULTI_CALL_SETUP_MINUTES,
} from "../consts";
import {
  HeadReadings,
  type RunContext,
  type SupersessionWatch,
} from "../types";
import { deriveNextHeadIndex } from "../utils";
import { isPermanentFailure } from "./errors";
import { isRunSignal } from "./run-signals";
import { readEntryPostHead } from "./supersession-watch";
import { replaceOnUnreadHead, type UnreadHeadPost } from "./unread-head-entry";

export interface GeneratingEntryPost extends UnreadHeadPost {
  readonly watch: SupersessionWatch;
}

/** A large run's detail calls: every one the grouping planned, and those no stored part answers. */
export interface LargeRunCalls {
  readonly planned: number;
  readonly missing: number;
}

/**
 * Settles a generating body whose head is not current: a moved head ends the
 * run before the detail calls and stands the post down after them, an unread
 * one replaces only this head's body. False when the head is current and the
 * caller writes the body.
 */
async function settleOffHeadPost(
  post: GeneratingEntryPost,
  body: string,
): Promise<boolean> {
  const head = await readEntryPostHead(post.watch);
  if (head.kind === HeadReadings.MOVED) {
    post.log.info("generate: head moved, leaving the generating Entry to it");
    return true;
  }
  if (head.kind === HeadReadings.UNREAD) {
    await replaceOnUnreadHead(post, body, head);
    return true;
  }
  return false;
}

/** A generating body on the thread; on a current head it refreshes the comment. */
export async function postGeneratingEntry(
  post: GeneratingEntryPost,
  body: string,
): Promise<void> {
  if (await settleOffHeadPost(post, body)) {
    return;
  }
  await post.entryCommentManager.refresh(body);
}

/**
 * Call 1 runs alone, the rest up to `detailConcurrency` at once, about three
 * minutes a call, plus the grouping call and the merge around them; rounded
 * to the nearest five minutes, never under five.
 */
export function estimateMultiCallMinutes(
  detailCalls: number,
  detailConcurrency: number,
): number {
  const lanes = Math.max(1, detailConcurrency);
  const laterCalls = Math.max(0, detailCalls - 1);
  const rounds = 1 + Math.ceil(laterCalls / lanes);
  const raw = rounds * DETAIL_CALL_MINUTES + MULTI_CALL_SETUP_MINUTES;
  const rounded =
    Math.round(raw / ESTIMATE_STEP_MINUTES) * ESTIMATE_STEP_MINUTES;
  return Math.max(ESTIMATE_STEP_MINUTES, rounded);
}

/**
 * The generating Entry, edited once after grouping with the parts to come
 * and when to expect the brief. The edit is cosmetic: a GitHub or storage
 * throw warns and the run goes on, while a run signal (a moved head before
 * the pin, a lost claim) or a permanent refusal (a row outside the scope, a
 * stamped failure) still ends it.
 */
export async function postLargeGeneratingEntry(
  context: RunContext,
  calls: LargeRunCalls,
): Promise<void> {
  try {
    await editLargeGeneratingEntry(context, calls);
  } catch (error) {
    if (isRunSignal(error) || isPermanentFailure(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    context.log.warn(
      "generate: the large run's generating Entry was not edited, the run goes on",
      { error: message },
    );
  }
}

/**
 * The parts line counts every planned call; the estimate counts only the
 * missing ones, since a resumed run reads the stored parts back. The edit
 * rewrites the comment in place, so it pings nobody; on an unread head the
 * body stays, since the guarded write there is a replace, which reposts.
 */
async function editLargeGeneratingEntry(
  context: RunContext,
  calls: LargeRunCalls,
): Promise<void> {
  const { deps, watch, entryCommentManager, priorBriefs, log } = context;
  if (context.run.entryCommentAllowed !== true) {
    return;
  }

  const headIndex = deriveNextHeadIndex(priorBriefs);
  const detailConcurrency =
    deps.detailConcurrency ?? DEFAULT_DETAIL_CONCURRENCY;
  const estimateMinutes = estimateMultiCallMinutes(
    calls.missing,
    detailConcurrency,
  );
  const body = buildEntryCommentGeneratingBody(
    deps.translate,
    entryCommentManager.buildDeepLink(headIndex),
    { parts: calls.planned, estimateMinutes },
  );

  const head = await readEntryPostHead(watch);
  if (head.kind === HeadReadings.MOVED) {
    log.info("generate: head moved, leaving the generating Entry to it");
    return;
  }
  if (head.kind === HeadReadings.UNREAD) {
    log.warn(
      "generate: head unread, the large run's generating Entry is left as it is",
      { error: head.error },
    );
    return;
  }
  await entryCommentManager.edit(body);
}
