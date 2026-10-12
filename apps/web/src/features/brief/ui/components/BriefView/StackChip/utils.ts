import type { TFunction } from "i18next";

import { buildGithubPullUrl } from "@web/utils/github-pull-url";
import type {
  LinearPrStack,
  LivePrState,
  PrStack,
  PrStackMember,
  PullStack,
} from "../../../../model/types";
import {
  NeighbourTargetKinds,
  StackDirections,
  type NeighbourTarget,
  type StackArrowView,
  type StackDirection,
  type StackNeighbours,
  type StackView,
} from "./types";

export function isLinearPrStack(stack: PrStack): stack is LinearPrStack {
  return "members" in stack;
}

function sameMembers(
  left: readonly PrStackMember[],
  right: readonly PrStackMember[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((member, index) => member.number === right[index]?.number);
}

/** Same PRs in the same places; titles are display and do not count. */
export function isSameStack(left: PrStack, right: PrStack): boolean {
  if (isLinearPrStack(left) && isLinearPrStack(right)) {
    return (
      left.index === right.index && sameMembers(left.members, right.members)
    );
  }
  if (isLinearPrStack(left) || isLinearPrStack(right)) {
    return false;
  }
  const sameParent = left.parent?.number === right.parent?.number;
  return sameParent && sameMembers(left.children, right.children);
}

/**
 * Which stack the chip shows. The read wins once it has answered, carrying
 * the record's `asOf` when that is what it served; the generation-time one
 * stands in until then, and rides along as `snapshot` when the two disagree.
 * A stackless answer hides the chip on an open PR, since GitHub sees no stack,
 * and on a closed one means nothing was ever recorded, so the snapshot is
 * the last stack anyone saw.
 */
export function resolveStackView(
  snapshot: PrStack | undefined,
  live: PullStack | undefined,
  state: LivePrState["state"] | undefined,
): StackView | undefined {
  if (live === undefined) {
    return snapshot === undefined ? undefined : { stack: snapshot };
  }
  if (live.stack === undefined) {
    return resolveClosedFallback(snapshot, state);
  }

  const view: StackView = { stack: live.stack };
  if (live.asOf !== undefined) {
    view.asOf = live.asOf;
  }
  if (snapshot !== undefined && !isSameStack(live.stack, snapshot)) {
    view.snapshot = snapshot;
  }
  return view;
}

function resolveClosedFallback(
  snapshot: PrStack | undefined,
  state: LivePrState["state"] | undefined,
): StackView | undefined {
  const closed = state === "closed" || state === "merged";
  if (!closed || snapshot === undefined) {
    return undefined;
  }
  return { stack: snapshot, atGeneration: true };
}

/**
 * The app route when the repo is known, the member's page on GitHub otherwise.
 */
export function resolveNeighbourTarget(
  member: PrStackMember,
  repoId: string | undefined,
  repoSlug: string,
): NeighbourTarget {
  if (repoId !== undefined) {
    return {
      kind: NeighbourTargetKinds.ROUTE,
      params: { repoId, prNumber: String(member.number) },
    };
  }
  const href = buildGithubPullUrl(repoSlug, member.number);
  if (href === undefined) {
    return { kind: NeighbourTargetKinds.NONE };
  }
  return { kind: NeighbourTargetKinds.GITHUB, href };
}

/** A fork, or a stack this PR is not in, has no previous and next. */
export function resolveStackNeighbours(
  stack: PrStack,
  currentNumber: number,
): StackNeighbours | undefined {
  if (!isLinearPrStack(stack)) {
    return undefined;
  }
  const position = stack.members.findIndex(
    (member) => member.number === currentNumber,
  );
  if (position === -1) {
    return undefined;
  }

  const neighbours: StackNeighbours = {};
  const previous = stack.members[position - 1];
  const next = stack.members[position + 1];
  if (previous !== undefined) {
    neighbours.previous = previous;
  }
  if (next !== undefined) {
    neighbours.next = next;
  }
  return neighbours;
}

/**
 * The arrow toward `member`, named for AT with its number and title; an end
 * of the stack, or a member with nowhere to go, reads as having none.
 */
export function resolveStackArrow(
  t: TFunction,
  direction: StackDirection,
  member: PrStackMember | undefined,
  repoId: string | undefined,
  repoSlug: string,
): StackArrowView {
  const previous = direction === StackDirections.PREVIOUS;
  if (member === undefined) {
    const none = previous
      ? t("brief.header.stackPreviousNone")
      : t("brief.header.stackNextNone");
    return {
      label: none,
      target: { kind: NeighbourTargetKinds.NONE },
      disabled: true,
    };
  }

  const values = { number: member.number, title: member.title };
  const named = previous
    ? t("brief.header.stackPrevious", values)
    : t("brief.header.stackNext", values);
  const target = resolveNeighbourTarget(member, repoId, repoSlug);
  const disabled = target.kind === NeighbourTargetKinds.NONE;
  if (target.kind === NeighbourTargetKinds.GITHUB) {
    return { label: `${named}${t("a11y.opensInNewTab")}`, target, disabled };
  }
  return { label: named, target, disabled };
}
