// The stack column's two sides on the live read: the write after a resolve,
// and what a closed PR serves once GitHub resolves nothing for it.
import {
  isSamePrStack,
  mergeStackHistory,
  PrStackSchema,
  type PrStack,
  type PrStackSelf,
  type StoredPrStack,
} from "brief-core/pr-stack";
import type { ForkPrStackView, PrStackView, PullStackView } from "contract";
import type { PullRequestInfo } from "github";
import type { Logger } from "logging";
import type { PullRequestRow, TenantRepository } from "persistence";

/**
 * What the row durably holds after a resolve was folded in. `readAt` is
 * absent when nothing is on the row: the fold never landed and no earlier
 * record exists, so the stack is the live resolve and carries no date.
 */
export interface RecordedStack {
  readonly stack: StoredPrStack;
  readonly readAt?: Date;
}

/**
 * Fold a resolve into the row's record and write it when that changed
 * anything. A failed write degrades the history view, never the read that
 * resolved: it logs and hands back the prior record when the row has one,
 * else the undated resolve, never a date that did not land.
 */
export async function recordResolvedStack(
  deps: { readonly tenant: TenantRepository; readonly log: Logger },
  pr: PullRequestRow,
  stack: PrStack,
  readAt: Date,
): Promise<RecordedStack> {
  const stored = PrStackSchema.safeParse(pr.stack);
  const merged = stored.success ? mergeStackHistory(stored.data, stack) : stack;
  if (
    stored.success &&
    pr.stackReadAt !== null &&
    isSamePrStack(stored.data, merged)
  ) {
    return { stack: merged, readAt: pr.stackReadAt };
  }

  const recorded = await deps.tenant.pullRequests.recordStack(pr.id, {
    stack: merged,
    readAt,
  });
  if (recorded.ok) {
    return { stack: merged, readAt };
  }

  deps.log.warn("stack record failed", {
    code: recorded.error.code,
    pullRequestId: String(pr.id),
  });
  if (stored.success && pr.stackReadAt !== null) {
    return { stack: stored.data, readAt: pr.stackReadAt };
  }
  return { stack: merged };
}

/** The record as the wire carries it, dated when the row holds it. */
export function shapeRecordedStack(record: RecordedStack): PullStackView {
  const view: PullStackView = { stack: shapeStackView(record.stack) };
  if (record.readAt !== undefined) {
    return { ...view, asOf: record.readAt.toISOString() };
  }
  return view;
}

/**
 * What a PR with no live stack serves: the record when GitHub reports the
 * PR closed or merged, since its neighbours merging is why nothing
 * resolves; null while it is open, since an open PR without neighbours has
 * no stack. GitHub's answer, not the row's state: a lost webhook leaves a
 * row open for good.
 */
export function shapeStoredStack(
  pr: PullRequestRow,
  selfOpen: boolean,
): PullStackView {
  if (selfOpen || pr.stackReadAt === null) {
    return { stack: null };
  }

  const parsed = PrStackSchema.safeParse(pr.stack);
  if (!parsed.success) {
    return { stack: null };
  }
  return {
    stack: shapeStackView(parsed.data),
    asOf: pr.stackReadAt.toISOString(),
  };
}

/** The refs of a PR the open list does not hold, from its own fetch. */
export function shapeFetchedSelf(
  prNumber: number,
  fetched: PullRequestInfo,
): PrStackSelf {
  const self: PrStackSelf = {
    number: prNumber,
    title: fetched.title,
    headRef: fetched.headRef,
  };
  if (fetched.baseRef !== undefined) {
    self.baseRef = fetched.baseRef;
  }
  if (fetched.headRepo !== undefined) {
    self.headRepo = fetched.headRepo;
  }
  if (fetched.baseRepo !== undefined) {
    self.baseRepo = fetched.baseRepo;
  }
  return self;
}

function shapeStackView(stack: StoredPrStack): PrStackView {
  if ("members" in stack) {
    return { members: stack.members, index: stack.index };
  }

  const fork: ForkPrStackView = { children: stack.children };
  if (stack.parent !== undefined) {
    return { ...fork, parent: stack.parent };
  }
  return fork;
}
