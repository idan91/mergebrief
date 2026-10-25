import type { TFunction } from "i18next";

import type { Span } from "../../../utils/briefRouteState";
import { readSpentHeadRerunNoteKey, type RerunNoteInput } from "../failed-head";

export interface WaitDetailInput {
  readonly span: Span | undefined;
  readonly stalled: boolean;
  readonly rerun: RerunNoteInput;
}

/** A stalled head promises no brief, so its detail names none coming and how it runs again. */
export function selectWaitDetail(t: TFunction, input: WaitDetailInput): string {
  if (input.stalled) {
    const rerunNote = t(readSpentHeadRerunNoteKey(input.rerun));
    return `${t("pulls.wait.stalledDetail")} ${rerunNote}`;
  }
  if (input.span === undefined) {
    return t("pulls.wait.diffPending");
  }
  return t("pulls.wait.diffReady");
}
