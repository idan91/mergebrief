import type { LinearPrStack, PrStack, PrStackMember } from "../../../../types";
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
 * Which stack the chip shows. The live one wins when it has been read; the
 * generation-time one stands in until then, and rides along as `snapshot`
 * only when the two disagree. Live null means GitHub sees no stack, and
 * that hides the chip rather than showing one that is not there.
 */
export function resolveStackView(
  snapshot: PrStack | undefined,
  live: PrStack | null | undefined,
): StackView | undefined {
  if (live === undefined) {
    return snapshot === undefined ? undefined : { stack: snapshot };
  }
  if (live === null) return undefined;
  const view: StackView = { stack: live };
  if (snapshot !== undefined && !isSameStack(live, snapshot)) {
    view.snapshot = snapshot;
  }
  return view;
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
