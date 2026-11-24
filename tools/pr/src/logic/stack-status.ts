import type { Result } from "types/utils";

import type { CommandRunner, PullStatus, StackStatus } from "../types";
import {
  fetchBranches,
  isBaseAncestor,
  readCheckout,
  readOriginUrl,
} from "./git";
import { fetchStack, parseRepoSlug } from "./github";
import { renderStackStatus } from "./render";
import { readReplyIds } from "./replies";
import { deriveActivityAfterHead, deriveOpenThreads } from "./status";

const OPEN_STATE = "OPEN";

export interface StackStatusDeps {
  readonly git: CommandRunner;
  readonly gh: CommandRunner;
  readonly replyStorePath: string;
}

export interface StackStatusReport {
  readonly text: string;
  /** True when a thread, new activity, a stale base or the checkout needs action. */
  readonly needsAttention: boolean;
}

function needsAttention(stack: StackStatus): boolean {
  const pullNeedsAction = stack.pulls.some(
    (status) =>
      status.openThreads.length > 0 ||
      status.activityAfterHead.length > 0 ||
      status.baseAligned === false ||
      (status.isOpen && status.pull.threadsTruncated),
  );
  const { top, checkout } = stack;
  const offTop =
    top !== undefined &&
    (checkout.branch !== top.head || checkout.headSha !== top.headSha);
  return pullNeedsAction || offTop;
}

/** Status for PRs given bottom first; the last open one is the stack top. */
export function runStackStatus(
  deps: StackStatusDeps,
  numbers: readonly number[],
): Result<StackStatusReport, Error> {
  const origin = readOriginUrl(deps.git);
  if (!origin.ok) {
    return origin;
  }
  const slug = parseRepoSlug(origin.value);
  if (!slug.ok) {
    return slug;
  }
  const replyIds = readReplyIds(deps.replyStorePath);
  if (!replyIds.ok) {
    return replyIds;
  }
  const pulls = fetchStack(deps.gh, slug.value, numbers);
  if (!pulls.ok) {
    return pulls;
  }

  const open = pulls.value.filter((pull) => pull.state === OPEN_STATE);
  const branches = [...new Set(open.flatMap((pull) => [pull.base, pull.head]))];
  const fetched = fetchBranches(deps.git, branches);

  const statuses = pulls.value.map((pull): PullStatus => {
    const isOpen = pull.state === OPEN_STATE;
    const status: PullStatus = {
      pull,
      isOpen,
      openThreads: isOpen
        ? deriveOpenThreads(pull.threads, replyIds.value)
        : [],
      activityAfterHead: isOpen
        ? deriveActivityAfterHead(pull, replyIds.value)
        : [],
    };
    if (!isOpen || !fetched) {
      return status;
    }
    const baseAligned = isBaseAncestor(deps.git, pull.base, pull.head);
    return baseAligned === undefined ? status : { ...status, baseAligned };
  });

  const stack: StackStatus = {
    pulls: statuses,
    checkout: readCheckout(deps.git),
    top: open.at(-1),
  };
  return {
    ok: true,
    value: {
      text: renderStackStatus(stack),
      needsAttention: needsAttention(stack),
    },
  };
}
