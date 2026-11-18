import {
  SpanReadKinds,
  type SpanKeyFacts,
  type SpanPair,
  type SpanRead,
} from "../types";

function isSamePair(left: SpanPair, right: SpanPair): boolean {
  return left.base === right.base && left.head === right.head;
}

/**
 * A Brief's own pair, or any pair on the PR's current base, is a whole-PR
 * read. A span's base is a briefed head or a Checkpoint SHA, so it meets
 * the PR's base only where a stacked PR's base is one of its own heads,
 * which reads the whole PR too. The base alone decides: the row's head
 * clears on a push before the next read lands.
 */
export function isWholePullRequestPair(
  pair: SpanPair,
  briefPairs: readonly SpanPair[],
  currentBase: string | undefined,
): boolean {
  if (pair.base === currentBase) {
    return true;
  }
  return briefPairs.some((briefPair) => isSamePair(pair, briefPair));
}

/**
 * A marked key is a span on the refs its row stores, never refs inferred
 * from Brief rows. An unmarked key the worker refused stays refused; any
 * other is a compare.
 */
export function classifySpanKey(pair: SpanPair, facts: SpanKeyFacts): SpanRead {
  const { marksRefs } = facts;
  if (marksRefs !== undefined) {
    const refs = {
      prevBase: marksRefs.prevBase,
      prevHead: pair.base,
      newBase: marksRefs.newBase,
      newHead: pair.head,
    };
    return { kind: SpanReadKinds.SPAN, refs };
  }
  if (facts.isRefused) {
    return { kind: SpanReadKinds.REFUSED };
  }
  return { kind: SpanReadKinds.COMPARE };
}
