import type { PrStack } from "../../../../../types";
import { ForkLists } from "../ForkLists";
import { NeighbourList } from "../NeighbourList";
import { isLinearPrStack } from "../utils";

export interface StackListsProps {
  stack: PrStack;
  currentNumber: number;
  prUrl: string;
  repoId: string | undefined;
  /** Accessible name for a chain's list; a fork names its lists by lead-in. */
  listLabel?: string | undefined;
}

export function StackLists({
  stack,
  currentNumber,
  prUrl,
  repoId,
  listLabel,
}: StackListsProps) {
  if (isLinearPrStack(stack)) {
    return (
      <NeighbourList
        currentNumber={currentNumber}
        label={listLabel}
        members={stack.members}
        prUrl={prUrl}
        repoId={repoId}
      />
    );
  }
  return (
    <ForkLists
      currentNumber={currentNumber}
      prUrl={prUrl}
      repoId={repoId}
      stack={stack}
    />
  );
}
