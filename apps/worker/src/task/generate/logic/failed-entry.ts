import type { BriefSpanRow } from "persistence";
import type { GenerationFailureCode } from "types/generations";
import {
  buildEntryCommentOnDemandBody,
  buildEntryCommentFailedBody,
  buildHeadEntryBodies,
} from "../../entry-comment";
import {
  HeadReadings,
  type RunContext,
  type RunProgress,
  type RunScope,
} from "../types";
import { deriveNextHeadIndex } from "../utils";
import { resolveRunEntryCommentAllowed } from "./entry-comment-gate";
import { replaceOnUnreadHead } from "./unread-head-entry";

interface FailedEntryBodies {
  readonly failedBody: string;
  /** This head's generating and failed bodies. */
  readonly headBodies: readonly string[];
  /** Names no head, so only a run that read its head as current replaces it. */
  readonly onDemandBody: string;
}

/**
 * The failed Entry, once this head's run ended `failed` for good. It replaces
 * this head's generating body or an earlier failed body of this head or, once
 * the run read the PR and its head, the on-demand body, or creates the
 * comment under the Entry gate; any other live body, an older head's
 * included, stays, and a stored brief keeps its ready body. Before that read
 * the gate is unknown, so it only replaces. A moved head leaves the comment to
 * the newer head's run, and an unread one only replaces a body that names
 * this head. A throw only warns.
 */
export async function postFailedEntry(
  progress: RunProgress,
  code: GenerationFailureCode,
): Promise<void> {
  const { scope, context } = progress;
  if (scope === undefined || scope.payload.grantId !== undefined) {
    return;
  }

  try {
    if (context === undefined) {
      await replaceFailedBody(scope, code);
    } else {
      await replaceOrCreateFailedBody(context, code);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scope.log.warn(
      `generate: failed entry comment skipped (job unaffected) — ${message}`,
    );
  }
}

async function replaceOrCreateFailedBody(
  context: RunContext,
  code: GenerationFailureCode,
): Promise<void> {
  if (await isBriefStored(context)) {
    return;
  }
  if (!(await resolveRunEntryCommentAllowed(context))) {
    return;
  }
  const head = await context.watch.readHead();
  if (head.kind === HeadReadings.MOVED) {
    context.log.info("generate: head moved, leaving the Entry comment to it");
    return;
  }

  const bodies = buildFailedEntryBodies(context, code, context.priorBriefs);
  if (head.kind === HeadReadings.UNREAD) {
    const post = {
      entryCommentManager: context.entryCommentManager,
      translate: context.deps.translate,
      headIndex: deriveNextHeadIndex(context.priorBriefs),
      log: context.log,
    };
    await replaceOnUnreadHead(post, bodies.failedBody, head);
    return;
  }
  await context.entryCommentManager.replaceOrCreate(bodies.failedBody, [
    ...bodies.headBodies,
    bodies.onDemandBody,
  ]);
}

async function replaceFailedBody(
  scope: RunScope,
  code: GenerationFailureCode,
): Promise<void> {
  const { payload, store } = scope;
  const priorBriefs = await store.briefs.listForPullRequest(
    payload.pullRequestId,
  );
  if (priorBriefs.some((row) => row.headSha === payload.headSha)) {
    return;
  }

  const bodies = buildFailedEntryBodies(scope, code, priorBriefs);
  await scope.entryCommentManager.replace(bodies.failedBody, bodies.headBodies);
}

function buildFailedEntryBodies(
  scope: RunScope,
  code: GenerationFailureCode,
  priorBriefs: readonly BriefSpanRow[],
): FailedEntryBodies {
  const { deps, entryCommentManager } = scope;
  const headLink = entryCommentManager.buildDeepLink(
    deriveNextHeadIndex(priorBriefs),
  );
  const failedBody = buildEntryCommentFailedBody(
    deps.translate,
    headLink,
    code,
  );
  return {
    failedBody,
    headBodies: buildHeadEntryBodies(deps.translate, headLink),
    onDemandBody: buildEntryCommentOnDemandBody(deps.translate, headLink),
  };
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
