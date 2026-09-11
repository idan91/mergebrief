import type { Mutable } from "types";

import type {
  ForkPrStack,
  LinearPrStack,
  OpenPullRequest,
  PrStack,
  PrStackMember,
  PrStackSelf,
  RepoIdentity,
} from "./types";

export type {
  ForkPrStack,
  LinearPrStack,
  OpenPullRequest,
  PrStack,
  PrStackMember,
  PrStackSelf,
  RepoIdentity,
} from "./types";
export { PrStackSchema } from "./schemas";

export function isLinearPrStack(stack: PrStack): stack is LinearPrStack {
  return "members" in stack;
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
