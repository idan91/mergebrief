import type { PrStack } from "../../../../../model/types";
import { ForkLists } from "../ForkLists";
import { NeighbourList } from "../NeighbourList";
import { isLinearPrStack } from "../utils";

export interface StackListsProps {
  stack: PrStack;
  currentNumber: number;
  repoSlug: string;
  repoId: string | undefined;
  /** Accessible name for a chain's list; a fork names its lists by lead-in. */
  listLabel?: string | undefined;
}

export function StackLists({
  stack,
  currentNumber,
  repoSlug,
  repoId,
  listLabel,
}: StackListsProps) {
  if (isLinearPrStack(stack)) {
    return (
      <NeighbourList
        currentNumber={currentNumber}
        label={listLabel}
        members={stack.members}
        repoSlug={repoSlug}
        repoId={repoId}
      />
    );
  }
  return (
    <ForkLists
      currentNumber={currentNumber}
      repoSlug={repoSlug}
      repoId={repoId}
      stack={stack}
    />
  );
}
