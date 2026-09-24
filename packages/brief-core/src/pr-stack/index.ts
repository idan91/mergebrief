import type { Mutable } from "types/utils";

import type {
  ForkPrStack,
  LinearPrStack,
  OpenPullRequest,
  PrStack,
  PrStackMember,
  PrStackSelf,
  RepoIdentity,
  StoredPrStack,
} from "./types";

export type {
  ForkPrStack,
  LinearPrStack,
  OpenPullRequest,
  PrStack,
  PrStackMember,
  PrStackSelf,
  RepoIdentity,
  StoredPrStack,
} from "./types";
export { PrStackSchema } from "./schemas";

export function isLinearPrStack(stack: PrStack): stack is LinearPrStack {
  return "members" in stack;
}

/**
 * The stack to record given what was stored and what just resolved. Stacks
 * merge bottom-up and GitHub retargets each child to the default branch, so
 * a later resolve is the same chain with its ancestors gone, possibly grown
 * at the tip: the stored ancestors graft back on, the resolve's members and
 * titles win from there, and the index shifts by the graft. A fork keeps
 * its stored parent when the resolve lost it. Anything else, a lost tip, a
 * reorder, a gap, a shape change, is new information and replaces the record.
 */
export function mergeStackHistory(
  stored: StoredPrStack,
  next: StoredPrStack,
): PrStack {
  if ("members" in stored && "members" in next) {
    return mergeLinearHistory(stored, next);
  }
  if (!("members" in stored) && !("members" in next)) {
    const parent = next.parent ?? stored.parent;
    return toPrStack({ parent, children: next.children });
  }
  return toPrStack(next);
}

function mergeLinearHistory(
  stored: LinearPrStack,
  next: LinearPrStack,
): PrStack {
  const storedNumbers = stored.members.map((member) => member.number);
  const nextNumbers = next.members.map((member) => member.number);
  const start = storedNumbers.indexOf(nextNumbers[0] ?? -1);
  if (start === -1) {
    return toPrStack(next);
  }

  const storedTail = storedNumbers.slice(start);
  const continues = storedTail.every(
    (number, offset) => nextNumbers[offset] === number,
  );
  if (!continues) {
    return toPrStack(next);
  }
  return {
    members: [
      ...stored.members.slice(0, start).map(toMember),
      ...next.members.map(toMember),
    ],
    index: next.index + start,
  };
}

/** Same members by number and title, in the same places. */
export function isSamePrStack(
  left: StoredPrStack,
  right: StoredPrStack,
): boolean {
  if ("members" in left && "members" in right) {
    return (
      left.index === right.index && sameMembers(left.members, right.members)
    );
  }
  if ("members" in left || "members" in right) {
    return false;
  }
  const sameParent =
    left.parent?.number === right.parent?.number &&
    left.parent?.title === right.parent?.title;
  return sameParent && sameMembers(left.children, right.children);
}

function sameMembers(
  left: readonly PrStackMember[],
  right: readonly PrStackMember[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every(
    (member, offset) =>
      member.number === right[offset]?.number &&
      member.title === right[offset]?.title,
  );
}

/** A stored shape back to the domain one: no explicit undefined parent. */
function toPrStack(stack: StoredPrStack): PrStack {
  if ("members" in stack) {
    return { members: stack.members.map(toMember), index: stack.index };
  }

  const fork: ForkPrStack = { children: stack.children.map(toMember) };
  if (stack.parent !== undefined) {
    fork.parent = toMember(stack.parent);
  }
  return fork;
}

function toMember(item: { number: number; title: string }): PrStackMember {
  return { number: item.number, title: item.title };
}

function sameGitRef(
  leftRef: string,
  leftRepo: RepoIdentity | undefined,
  rightRef: string,
  rightRepo: RepoIdentity | undefined,
): boolean {
  if (leftRepo === undefined || rightRepo === undefined) return false;
  if (leftRef === "" || rightRef === "") return false;
  return (
    leftRef === rightRef &&
    leftRepo.owner === rightRepo.owner &&
    leftRepo.repo === rightRepo.repo
  );
}

function findParent(
  node: PrStackSelf,
  open: readonly OpenPullRequest[],
): OpenPullRequest | undefined {
  const baseRef = node.baseRef;
  if (baseRef === undefined || baseRef === "") return undefined;
  const matches = open.filter(
    (item) =>
      item.number !== node.number &&
      sameGitRef(item.headRef, item.headRepo, baseRef, node.baseRepo),
  );
  if (matches.length !== 1) return undefined;
  const parent = matches[0];
  if (parent === undefined) return undefined;
  return parent;
}

function findChildren(
  node: PrStackSelf,
  open: readonly OpenPullRequest[],
): OpenPullRequest[] {
  if (node.headRef === "") return [];
  return open.filter(
    (item) =>
      item.number !== node.number &&
      sameGitRef(item.baseRef, item.baseRepo, node.headRef, node.headRepo),
  );
}

export function resolvePrStack(
  self: PrStackSelf,
  open: readonly OpenPullRequest[],
): PrStack | undefined {
  const children = findChildren(self, open);
  if (children.length >= 2) {
    const fork: Mutable<ForkPrStack> = {
      children: children.map(toMember),
    };
    const parent = findParent(self, open);
    if (parent !== undefined) fork.parent = toMember(parent);
    return fork;
  }

  const seen = new Set<number>([self.number]);
  const ancestors: OpenPullRequest[] = [];
  let cursor: PrStackSelf = self;
  for (;;) {
    const parent = findParent(cursor, open);
    if (parent === undefined) break;
    if (seen.has(parent.number)) break;
    seen.add(parent.number);
    ancestors.push(parent);
    cursor = parent;
  }

  const descendants: OpenPullRequest[] = [];
  cursor = self;
  for (;;) {
    const nextChildren = findChildren(cursor, open);
    if (nextChildren.length !== 1) break;
    const child = nextChildren[0];
    if (child === undefined || seen.has(child.number)) break;
    seen.add(child.number);
    descendants.push(child);
    cursor = child;
  }

  if (ancestors.length === 0 && descendants.length === 0) return undefined;

  const members = [
    ...ancestors.toReversed().map(toMember),
    toMember(self),
    ...descendants.map(toMember),
  ];
  if (members.length < 2) return undefined;

  return { members, index: ancestors.length + 1 };
}

export function attachPrStack(
  meta: {
    title: string;
    headRef?: string;
    baseRef?: string;
    headRepo?: RepoIdentity;
    baseRepo?: RepoIdentity;
    stack?: PrStack;
  },
  selfNumber: number,
  open: readonly OpenPullRequest[],
): void {
  const self: Mutable<PrStackSelf> = {
    number: selfNumber,
    title: meta.title,
    headRef: meta.headRef ?? "",
  };
  if (meta.baseRef !== undefined) self.baseRef = meta.baseRef;
  if (meta.headRepo !== undefined) self.headRepo = meta.headRepo;
  if (meta.baseRepo !== undefined) self.baseRepo = meta.baseRepo;
  const stack = resolvePrStack(self, open);
  if (stack !== undefined) meta.stack = stack;
}
