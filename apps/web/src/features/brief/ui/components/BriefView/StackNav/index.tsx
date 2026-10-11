import type { Brief, LivePrState } from "../../../../model/types";
import { StackChip } from "../StackChip";
import { StackArrows } from "../StackChip/StackArrows";
import { resolveStackView } from "../StackChip/utils";

export interface StackNavProps {
  brief: Brief;
  livePrState?: LivePrState | undefined;
  repoId?: string | undefined;
}

/** The PR's place in its stack with arrows to its neighbours; nothing when it sits in none. */
export function StackNav({ brief, livePrState, repoId }: StackNavProps) {
  const stackView = resolveStackView(
    brief.pr.stack,
    livePrState?.stack,
    livePrState?.state,
  );
  if (stackView === undefined) {
    return null;
  }

  return (
    <StackArrows
      currentNumber={brief.pr.number}
      repoSlug={brief.pr.repo}
      repoId={repoId}
      stack={stackView.stack}
    >
      <StackChip
        asOf={stackView.asOf}
        atGeneration={stackView.atGeneration}
        currentNumber={brief.pr.number}
        repoSlug={brief.pr.repo}
        repoId={repoId}
        snapshot={stackView.snapshot}
        stack={stackView.stack}
      />
    </StackArrows>
  );
}
