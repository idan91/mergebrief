import type { TFunction } from "i18next";
import { GenerationFailureCodes, GenerationStatuses } from "types";
import type { Mutable } from "types/utils";

import type { GenerationSummary, PrSummary } from "../../../../../types";
import { hasStoredHeadBrief } from "../../../../../utils/briefRouteState";
import { awaitsReadyForReview } from "../../../../../utils/draft-policy";
import { draftPolicyNotice } from "../../../../../utils/ownDraft";
import {
  isNoLongerOpen,
  readSupersededStop,
} from "../../../../../utils/pr-state";
import { readAwaitingDetailKey } from "../../../awaiting-head";
import { isPastDailyCap, readCapReset } from "../../../capped-head";
import { isRerunHopeless } from "@web/utils/failure-class";
import {
  readOffersRegenerate,
  readSpentHeadRerunNoteKey,
} from "../../../failed-head";
import { readOffersTrigger } from "../../../trigger-offer";
import { waitLabel } from "../../../waiting-head";
import { RunActionLabels } from "./consts";
import { LatestPushStates, type LatestPushState } from "./latest-push/types";
import {
  buildPastCapPushLines,
  buildCappedPushDetail,
  buildFailedPushDetail,
  readCapResumeLine,
  readLatestPushState,
} from "./latest-push";
import {
  NewerCommitsActionKinds,
  NewerCommitsStates,
  type NewerCommitsAction,
  type NewerCommitsInput,
  type NewerCommitsRun,
  type NewerCommitsState,
  type NewerCommitsStatus,
  type RunActionKind,
} from "./types";

/** The state half of a status: everything but the frame every state shares. */
type StateCopy = Omit<NewerCommitsStatus, "label" | "infoLabel">;

function buildRunAction(
  t: TFunction,
  kind: RunActionKind,
  run: NewerCommitsRun,
): NewerCommitsAction {
  const keys = RunActionLabels[kind];
  const label = run.pending ? t(keys.pending) : t(keys.rest);
  return { kind, label, pending: run.pending, onTrigger: run.trigger };
}

/** A url row's run goes through the paste path; absent where its URL is unknown. */
function readPasteRun(input: NewerCommitsInput): NewerCommitsRun | undefined {
  const { meta, pasteRun } = input;
  const { trigger } = pasteRun;
  const offered = meta.behind && !meta.appInstalled;
  const runnable = offered && trigger !== undefined;
  if (!runnable) {
    return undefined;
  }
  return { pending: pasteRun.pending, trigger };
}

/** A status segment that is also the popover's heading. */
function describeLabelled(
  state: NewerCommitsState,
  label: string,
  explanation: readonly string[],
): Mutable<StateCopy> {
  return { state, statusLabel: label, title: label, explanation };
}

function describeNewBrief(t: TFunction, onGoToNewest: () => void): StateCopy {
  return {
    state: NewerCommitsStates.NEW_BRIEF,
    title: t("pulls.newerCommits.titles.newBrief"),
    explanation: [t("pulls.newerCommits.explain.newBrief")],
    action: {
      kind: NewerCommitsActionKinds.NAVIGATE,
      label: t("pulls.newerCommits.action.goToNewBrief"),
      pending: false,
      onTrigger: onGoToNewest,
    },
  };
}

/** A pending head names why it has not started; a running one needs no more. */
function describeGenerating(
  t: TFunction,
  meta: PrSummary,
  generation: GenerationSummary,
): StateCopy {
  const explanation = [t("pulls.newerCommits.explain.generating")];
  if (generation.status === GenerationStatuses.PENDING) {
    const pendingNotice = draftPolicyNotice(t, meta.draftPolicy, meta);
    const damped = pendingNotice?.kind === "damped";
    explanation.push(
      waitLabel(t, {
        status: generation.status,
        phase: generation.phase,
        waitReason: generation.waitReason,
        pendingNotice: damped ? pendingNotice.text : undefined,
      }),
    );
  }
  return describeLabelled(
    NewerCommitsStates.GENERATING,
    t("pulls.newerCommits.status.generating"),
    explanation,
  );
}

/** A url row's paste of a stalled head, which briefs whatever head GitHub names now. */
function readStalledPasteRun(
  input: NewerCommitsInput,
): NewerCommitsRun | undefined {
  const { meta, pasteRun } = input;
  const { trigger } = pasteRun;
  const pasteable = !meta.appInstalled && trigger !== undefined;
  if (!pasteable) {
    return undefined;
  }
  return { pending: pasteRun.pending, trigger };
}

/** Nothing runs a stalled head on its own: a url row keeps its paste, any other row names what queues the next run. */
function describeStalled(t: TFunction, input: NewerCommitsInput): StateCopy {
  const { meta } = input;
  const label = t("pulls.newerCommits.status.stopped");
  const stopped = [t("pulls.wait.stalled"), t("pulls.wait.stalledDetail")];
  const run = readStalledPasteRun(input);
  if (run === undefined) {
    const rerunKey = readSpentHeadRerunNoteKey({
      prState: meta.state,
      appInstalled: meta.appInstalled,
      awaitsReadyForReview: awaitsReadyForReview(meta),
    });
    return describeLabelled(NewerCommitsStates.STALLED, label, [
      ...stopped,
      t(rerunKey),
    ]);
  }
  const copy = describeLabelled(NewerCommitsStates.STALLED, label, [
    ...stopped,
    t("pulls.newerCommits.explain.pasted"),
  ]);
  copy.action = buildRunAction(t, NewerCommitsActionKinds.GENERATE, run);
  return copy;
}

/** May generate: the action alone. May not: the status alone. Closed: none will come. */
function describeAwaiting(t: TFunction, input: NewerCommitsInput): StateCopy {
  const { meta } = input;
  if (isNoLongerOpen(meta.state)) {
    return describeNoBriefLine(t, t("pulls.awaitingTrigger.notOpenCopy"));
  }
  const title = t("pulls.newerCommits.status.onDemand");
  const detailKey = readAwaitingDetailKey({
    noLongerOpen: false,
    awaitsReadyForReview: awaitsReadyForReview(meta),
  });
  const offersGenerate = readOffersTrigger({
    prState: meta.state,
    viewerCanPush: meta.viewerCanPush,
    appInstalled: meta.appInstalled,
  });
  if (!offersGenerate) {
    return describeLabelled(NewerCommitsStates.ON_DEMAND, title, [
      t(detailKey),
    ]);
  }
  return {
    state: NewerCommitsStates.ON_DEMAND,
    title,
    explanation: [t(detailKey)],
    action: buildRunAction(
      t,
      NewerCommitsActionKinds.GENERATE,
      input.latestRun,
    ),
  };
}

/** The installation row's Retry under the route's bar. */
function readRetryRun(
  input: NewerCommitsInput,
  generation: GenerationSummary,
): NewerCommitsRun | undefined {
  const { meta } = input;
  const offersRegenerate = readOffersRegenerate({
    errorCode: generation.errorCode,
    viewerCanPush: meta.viewerCanPush,
    appInstalled: meta.appInstalled,
    prState: meta.state,
  });
  if (!offersRegenerate) {
    return undefined;
  }
  return input.latestRun;
}

/**
 * A url row's paste of its failed head. Nothing proves GitHub moved past
 * that head, so a cannot-help failure gets none: a paste would fail it the
 * same way.
 */
function readFailedPasteRun(
  input: NewerCommitsInput,
  generation: GenerationSummary,
): NewerCommitsRun | undefined {
  if (isRerunHopeless(generation)) {
    return undefined;
  }
  return readPasteRun(input);
}

/**
 * Out of attempts and every other failure share a shape; only the segment
 * differs. An installation row retries the failed push; a url row's paste
 * briefs the newer head GitHub names, so it generates rather than retries.
 */
function describeFailed(
  t: TFunction,
  input: NewerCommitsInput,
  generation: GenerationSummary,
): StateCopy {
  const { meta } = input;
  const retryRun = readRetryRun(input, generation);
  const pasteRun =
    retryRun === undefined ? readFailedPasteRun(input, generation) : undefined;
  const offersRun = retryRun !== undefined || pasteRun !== undefined;
  const exhausted =
    generation.errorCode === GenerationFailureCodes.ATTEMPTS_EXHAUSTED;
  const detail = buildFailedPushDetail(t, {
    generation,
    offersRegenerate: offersRun,
    prState: meta.state,
    appInstalled: meta.appInstalled,
    awaitsReadyForReview: awaitsReadyForReview(meta),
  });
  const copy = exhausted
    ? describeLabelled(
        NewerCommitsStates.EXHAUSTED,
        t("pulls.newerCommits.status.exhausted"),
        [detail],
      )
    : describeLabelled(
        NewerCommitsStates.FAILED,
        t("pulls.newerCommits.status.failed"),
        [detail],
      );
  if (retryRun !== undefined) {
    copy.explanation = [detail, t("pulls.newerCommits.explain.retry")];
    copy.action = buildRunAction(t, NewerCommitsActionKinds.RETRY, retryRun);
  }
  if (pasteRun !== undefined) {
    copy.explanation = [detail, t("pulls.newerCommits.explain.pasted")];
    copy.action = buildRunAction(t, NewerCommitsActionKinds.GENERATE, pasteRun);
  }
  return copy;
}

/** A capped head never reruns on its own; a url row's paste briefs the newer head once the cap resets. */
function describeSkipped(
  t: TFunction,
  input: NewerCommitsInput,
  generation: GenerationSummary,
): StateCopy {
  const { meta } = input;
  const units = generation.cappedUnits;
  const lead =
    units === undefined
      ? t("pulls.newerCommits.explain.capped")
      : t("pulls.newerCommits.explain.cappedUnits");
  const label = t("pulls.newerCommits.status.skipped");
  const run = readPasteRun(input);
  if (run !== undefined && units !== undefined && isPastDailyCap(units)) {
    const lines = [lead, ...buildPastCapPushLines(t, units)];
    const copy = describeLabelled(NewerCommitsStates.SKIPPED, label, lines);
    copy.action = buildRunAction(t, NewerCommitsActionKinds.GENERATE, run);
    return copy;
  }
  if (run !== undefined) {
    const reset = readCapReset(generation.updatedAt, new Date());
    const resume = readCapResumeLine(t, reset);
    const pasteLine =
      reset?.passed === true
        ? t("pulls.newerCommits.explain.pasted")
        : t("pulls.newerCommits.explain.generateAfterReset");
    const lines = [lead];
    if (units !== undefined) {
      lines.push(
        t("pulls.latestPush.capped.needsUnits", {
          count: units.needed,
          left: units.left,
        }),
      );
    }
    lines.push(resume, pasteLine);
    const copy = describeLabelled(NewerCommitsStates.SKIPPED, label, lines);
    copy.action = buildRunAction(t, NewerCommitsActionKinds.GENERATE, run);
    return copy;
  }
  const detail = buildCappedPushDetail(t, {
    cappedAt: generation.updatedAt,
    prState: meta.state,
    appInstalled: meta.appInstalled,
    awaitsReadyForReview: awaitsReadyForReview(meta),
    units: generation.cappedUnits,
  });
  return describeLabelled(NewerCommitsStates.SKIPPED, label, [lead, detail]);
}

function describeNoBriefLine(t: TFunction, line: string): Mutable<StateCopy> {
  return describeLabelled(
    NewerCommitsStates.NO_BRIEF,
    t("pulls.newerCommits.status.none"),
    [line],
  );
}

/** Why no run covers the newer commits on an installation row. */
function readInstalledNoBriefLine(t: TFunction, meta: PrSummary): string {
  if (isNoLongerOpen(meta.state)) {
    return t("pulls.failed.notOpenNote");
  }
  if (awaitsReadyForReview(meta)) {
    return t("pulls.empty.awaitsReadyCopy");
  }
  return t("pulls.newerCommits.explain.waiting");
}

/** A url row GitHub is ahead of may paste whatever its PR state; an installation row says why none comes. */
function describeNoBrief(t: TFunction, input: NewerCommitsInput): StateCopy {
  const { meta } = input;
  if (meta.appInstalled) {
    return describeNoBriefLine(t, readInstalledNoBriefLine(t, meta));
  }
  const run = readPasteRun(input);
  if (run === undefined) {
    return describeNoBriefLine(
      t,
      t("pulls.newerCommits.explain.pastedNoAction"),
    );
  }
  return {
    state: NewerCommitsStates.NO_BRIEF,
    title: t("pulls.newerCommits.titles.notGenerated"),
    explanation: [t("pulls.newerCommits.explain.pasted")],
    action: buildRunAction(t, NewerCommitsActionKinds.GENERATE, run),
  };
}

/** A superseded head with nothing stopping it hands over to the newest push. */
function isHandedToNewerPush(meta: PrSummary): boolean {
  const superseded = meta.generation?.status === GenerationStatuses.SUPERSEDED;
  const handedOver = superseded && readSupersededStop(meta) === undefined;
  return handedOver;
}

function describeLatestPush(
  t: TFunction,
  input: NewerCommitsInput,
  latest: LatestPushState,
  generation: GenerationSummary,
): StateCopy {
  switch (latest) {
    case LatestPushStates.GENERATING:
      return describeGenerating(t, input.meta, generation);
    case LatestPushStates.STALLED:
      return describeStalled(t, input);
    case LatestPushStates.AWAITING_TRIGGER:
      return describeAwaiting(t, input);
    case LatestPushStates.FAILED:
      return describeFailed(t, input, generation);
    case LatestPushStates.CAPPED:
      return describeSkipped(t, input, generation);
  }
}

/** The head's brief is stored, but only on a base the PR has since left. */
function coversHeadOnEarlierBase(meta: PrSummary): boolean {
  const earlierBaseOnly = hasStoredHeadBrief(meta) && !meta.briefAvailable;
  const coversEarlierBase = earlierBaseOnly && !meta.behind;
  return coversEarlierBase;
}

/**
 * A newer stored brief beside an unbriefed latest push: the chip keeps the
 * latest push's status and moves to the newer brief, and the popover still
 * offers that push's run. The newer brief may be the latest push's own, on
 * the base a retarget left.
 */
function describeBesideNewerBrief(
  t: TFunction,
  meta: PrSummary,
  latestCopy: StateCopy,
  onGoToNewest: () => void,
): StateCopy {
  const newerBriefLine = coversHeadOnEarlierBase(meta)
    ? t("pulls.newerCommits.explain.newerBriefEarlierBase")
    : t("pulls.newerCommits.explain.newerBriefOlderPush");
  const copy: Mutable<StateCopy> = {
    ...latestCopy,
    statusLabel: latestCopy.statusLabel ?? latestCopy.title,
    explanation: [newerBriefLine, ...latestCopy.explanation],
    action: {
      kind: NewerCommitsActionKinds.NAVIGATE,
      label: t("pulls.newerCommits.action.goToNewerBrief"),
      pending: false,
      onTrigger: onGoToNewest,
    },
  };
  if (latestCopy.action !== undefined) {
    copy.runAction = latestCopy.action;
  }
  return copy;
}

/** What the PR's head is doing, read as if no newer stored brief existed. */
function describeHeadState(t: TFunction, input: NewerCommitsInput): StateCopy {
  const { meta } = input;
  const { generation } = meta;
  if (generation === undefined) {
    return describeNoBrief(t, input);
  }
  const latest = readLatestPushState(meta);
  if (latest !== undefined) {
    return describeLatestPush(t, input, latest, generation);
  }
  if (isHandedToNewerPush(meta)) {
    return describeLabelled(
      NewerCommitsStates.GENERATING,
      t("pulls.newerCommits.status.generating"),
      [t("pulls.newerCommits.explain.superseded")],
    );
  }
  return describeNoBrief(t, input);
}

/** The newest stored brief covers what GitHub has: the head's, with nothing ahead of it. */
function isHeadBriefNewest(meta: PrSummary): boolean {
  const latestCovered = readLatestPushState(meta) === undefined;
  const briefed = latestCovered && hasStoredHeadBrief(meta);
  const headBriefNewest = briefed && !meta.behind;
  return headBriefNewest;
}

/** Go to new brief alone only where that brief covers the head; otherwise the head's state stays beside it. */
function describeState(t: TFunction, input: NewerCommitsInput): StateCopy {
  const { meta, onGoToNewest } = input;
  const newerBriefStored = input.staleHead && onGoToNewest !== undefined;
  if (!newerBriefStored) {
    return describeHeadState(t, input);
  }
  if (isHeadBriefNewest(meta)) {
    return describeNewBrief(t, onGoToNewest);
  }
  return describeBesideNewerBrief(
    t,
    meta,
    describeHeadState(t, input),
    onGoToNewest,
  );
}

/**
 * The one chip for every way the brief on screen trails the pull request.
 * Absent while a brief for the PR's head is stored on any base and GitHub has
 * no newer commits, unless the current base's run failed or awaits approval.
 * The label says newer commits, or a new base where the head is the same;
 * the first state that applies wins: a newer stored brief, the latest push's
 * run, a newer push taking over, then no new brief. A paste always lands on
 * the head GitHub names, so a url row's run in flight reads as the latest
 * push's.
 */
export function deriveNewerCommitsStatus(
  t: TFunction,
  input: NewerCommitsInput,
): NewerCommitsStatus | undefined {
  const { meta, staleHead } = input;
  const latest = readLatestPushState(meta);
  const newerCommits = staleHead || meta.behind;
  const applies = newerCommits || latest !== undefined;
  if (!applies) {
    return undefined;
  }

  const copy = describeState(t, input);
  const lead = newerCommits
    ? t("pulls.newerCommits.lead")
    : t("pulls.newerCommits.newBaseLead");
  const explanation = [lead, ...copy.explanation];
  if (staleHead) {
    explanation.push(t("pulls.newerCommits.anchorNote"));
  }
  const status: Mutable<NewerCommitsStatus> = {
    ...copy,
    label: newerCommits
      ? t("pulls.newerCommits.label")
      : t("pulls.newerCommits.newBaseLabel"),
    infoLabel: newerCommits
      ? t("pulls.newerCommits.infoLabel")
      : t("pulls.newerCommits.newBaseInfoLabel"),
    explanation,
  };
  if (input.pasteRun.failure !== undefined) {
    status.failure = input.pasteRun.failure;
  }
  return status;
}
