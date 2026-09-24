import { PrStates, type PrState } from "@web/features/pulls/types";
import type {
  LinearPrStack,
  PrStack,
  PrStackMember,
  PullStack,
} from "../../../../types";
import type { StackView } from "./types";

export function isLinearPrStack(stack: PrStack): stack is LinearPrStack {
  return "members" in stack;
}

function sameMembers(
  left: readonly PrStackMember[],
  right: readonly PrStackMember[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((member, index) => member.number === right[index]?.number);
}

/** Same PRs in the same places; titles are display and do not count. */
export function isSameStack(left: PrStack, right: PrStack): boolean {
  if (isLinearPrStack(left) && isLinearPrStack(right)) {
    return (
      left.index === right.index && sameMembers(left.members, right.members)
    );
  }
  if (isLinearPrStack(left) || isLinearPrStack(right)) return false;
  const sameParent = left.parent?.number === right.parent?.number;
  return sameParent && sameMembers(left.children, right.children);
}

/**
 * Which stack the chip shows. The read wins once it has answered, carrying
 * the record's `asOf` when that is what it served; the generation-time one
 * stands in until then, and rides along as `snapshot` when the two disagree.
 * A null answer hides the chip on an open PR, since GitHub sees no stack,
 * and on a closed one means nothing was ever recorded, so the snapshot is
 * the last stack anyone saw.
 */
export function resolveStackView(
  snapshot: PrStack | undefined,
  live: PullStack | undefined,
  state: PrState | undefined,
): StackView | undefined {
  if (live === undefined) {
    return snapshot === undefined ? undefined : { stack: snapshot };
  }
  if (live.stack === null) {
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
  state: PrState | undefined,
): StackView | undefined {
  const closed = state === PrStates.CLOSED || state === PrStates.MERGED;
  if (!closed || snapshot === undefined) {
    return undefined;
  }
  return { stack: snapshot, atGeneration: true };
}

/** Swap the pull number in a GitHub PR URL; undefined when the path is not a pull. */
export function rewritePullUrl(
  url: string,
  number: number,
): string | undefined {
  try {
    const parsed = new URL(url);
    if (!/\/pull\/\d+(?:\/|$)/.test(parsed.pathname)) return undefined;
    parsed.pathname = parsed.pathname.replace(
      /\/pull\/\d+/,
      `/pull/${String(number)}`,
    );
    return parsed.toString();
  } catch {
    return undefined;
  }
}
