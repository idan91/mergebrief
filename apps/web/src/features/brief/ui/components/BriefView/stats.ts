import type { ProgressTotals } from "../../utils/progress";
import { GroupViewKinds } from "../../../model/utils/remainder";
import {
  hasChangedLines,
  type BriefViewModel,
  type UnattributedRemainderGroupView,
} from "../../../model/utils/view-model";
import type { StatFigures } from "./types";

/** The remainder the line stat counts; one holding only flagged files with no changed line has none to count. */
export function findCountedRemainder(
  model: BriefViewModel,
): UnattributedRemainderGroupView | undefined {
  return model.groups.find((group): group is UnattributedRemainderGroupView => {
    const isCountedRemainder =
      group.kind === GroupViewKinds.UNATTRIBUTED_REMAINDER &&
      hasChangedLines(group);
    return isCountedRemainder;
  });
}

/** Read and resolved of the totals; the viewer's own draft resolves no flag, so it shows the bare total. */
export function deriveStatFigures(
  totals: ProgressTotals,
  ownDraft: boolean,
): StatFigures {
  const chunks: StatFigures["chunks"] = `${totals.reviewed}/${totals.chunkTotal}`;
  if (ownDraft) {
    return { chunks, flags: `${totals.flagTotal}` };
  }
  return { chunks, flags: `${totals.flagsResolved}/${totals.flagTotal}` };
}
