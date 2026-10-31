import type { GenerationPartsView } from "contract";
import type { TFunction } from "i18next";

import { formatDate } from "@web/i18n/locale";
import type { Span } from "../../../utils/briefRouteState";
import { readSpentHeadRerunNoteKey, type RerunNoteInput } from "../failed-head";
import { describePartsProgress } from "../waiting-head";

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

export interface WaitProgressInput {
  readonly status: "pending" | "running";
  readonly parts: GenerationPartsView | undefined;
  readonly startedAt: string | undefined;
  readonly locale: string;
}

const CLOCK_FORMAT: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

/**
 * The quiet line under a running wait: the parts a multi-call run has
 * finished, and when the run started. A pending wait has neither.
 */
export function selectWaitProgress(
  t: TFunction,
  input: WaitProgressInput,
): string | undefined {
  if (input.status !== "running") {
    return undefined;
  }
  const lines: string[] = [];
  if (input.parts !== undefined) {
    lines.push(describePartsProgress(t, input.parts));
  }
  if (input.startedAt !== undefined) {
    const time = formatDate(input.startedAt, input.locale, CLOCK_FORMAT);
    lines.push(t("pulls.wait.startedAt", { time }));
  }
  return lines.length === 0 ? undefined : lines.join(" ");
}
