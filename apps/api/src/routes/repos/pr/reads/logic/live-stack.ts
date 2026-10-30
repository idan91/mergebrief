// The live resolve as the wire carries it: each member's draft flag and
// branches come from the open list, the PR's own from its fetch.
import type { OpenPullRequest, PrStack } from "brief-core/pr-stack";
import {
  PrStackMemberStates,
  type ForkPrStackView,
  type PrStackMemberView,
  type PrStackView,
  type PullStackView,
} from "contract";
import type { Mutable } from "types/utils";

/** What the live read knows of one member: its open-list entry, or the PR's own fetch. */
export interface LiveMemberDetails {
  readonly number: number;
  readonly draft: boolean;
  readonly headRef: string;
  readonly baseRef?: string;
}

/** The PR's own details win: the open list can predate it by the cache TTL. */
function findDetails(
  self: LiveMemberDetails,
  open: readonly OpenPullRequest[],
  number: number,
): LiveMemberDetails | undefined {
  if (number === self.number) {
    return self;
  }
  return open.find((item) => item.number === number);
}

function shapeMember(
  member: { number: number; title: string },
  self: LiveMemberDetails,
  open: readonly OpenPullRequest[],
): PrStackMemberView {
  const view: Mutable<PrStackMemberView> = {
    number: member.number,
    title: member.title,
  };
  const listed = findDetails(self, open, member.number);
  if (listed === undefined) {
    return view;
  }

  view.state = listed.draft
    ? PrStackMemberStates.DRAFT
    : PrStackMemberStates.OPEN;
  view.headRef = listed.headRef;
  return view;
}

/**
 * The branch under the list's bottom row: a chain's first member's base, a
 * fork's parent's base, or the PR's own when the fork has no parent. A fork
 * reaches one level down, not to the root its parent may sit on.
 */
function resolveBaseRef(
  stack: PrStack,
  self: LiveMemberDetails,
  open: readonly OpenPullRequest[],
): string | undefined {
  const bottom = "members" in stack ? stack.members[0] : stack.parent;
  const listed = findDetails(self, open, bottom?.number ?? self.number);
  if (listed?.baseRef === undefined || listed.baseRef === "") {
    return undefined;
  }
  return listed.baseRef;
}

export function shapeLiveStack(
  stack: PrStack,
  self: LiveMemberDetails,
  open: readonly OpenPullRequest[],
): PullStackView {
  const baseRef = resolveBaseRef(stack, self, open);
  if ("members" in stack) {
    const chain: Mutable<PrStackView> = {
      members: stack.members.map((member) => shapeMember(member, self, open)),
      index: stack.index,
    };
    if (baseRef !== undefined) {
      chain.baseRef = baseRef;
    }
    return { stack: chain };
  }

  const fork: Mutable<ForkPrStackView> = {
    children: stack.children.map((member) => shapeMember(member, self, open)),
  };
  if (stack.parent !== undefined) {
    fork.parent = shapeMember(stack.parent, self, open);
  }
  if (baseRef !== undefined) {
    fork.baseRef = baseRef;
  }
  return { stack: fork };
}
