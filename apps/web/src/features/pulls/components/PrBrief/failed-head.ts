import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";

import { MAX_BRIEFED_CHANGED_FILES } from "brief-core/types";

import {
  GenerationFailureClasses,
  GenerationFailureCodes,
  PrStates,
  type GenerationFailureCode,
  type PrState,
} from "types";
import { readFailureClass } from "@web/utils/failure-class";
import { UnknownValues, type UnknownValue } from "@web/utils/open-enum/types";

import { readOffersTrigger, type TriggerOfferInput } from "./trigger-offer";

/** The two codes whose template interpolates a `{{detail}}`. */
const DETAIL_CODES: ReadonlySet<string> = new Set([
  GenerationFailureCodes.GENERATION_CONFIG,
  GenerationFailureCodes.UNKNOWN,
]);

/**
 * The failure sentence. A known code renders `generationError.<code>`, the
 * verbatim-code lookup the spec specifies, so no mapping table can drift.
 * A detail-carrying code with no detail, and an unrecognized code with no
 * detail, both degrade to the no-detail copy rather than printing a template
 * with a hole; an unrecognized code that DID carry a detail keeps it through
 * the generic line.
 */
export function buildFailureLine(
  t: TFunction,
  errorCode: GenerationFailureCode | undefined,
  errorDetail: string | undefined,
): string {
  const detail = errorDetail ?? "";
  if (errorCode === undefined) {
    return detail === ""
      ? t("pulls.failed.noDetail")
      : t("generationError.unknown", { detail });
  }
  if (DETAIL_CODES.has(errorCode) && detail === "") {
    return t("pulls.failed.noDetail");
  }
  return t(`generationError.${errorCode}`, {
    detail,
    maxFiles: MAX_BRIEFED_CHANGED_FILES,
  });
}

/** What an operator or the App must change before a fix-first code can rerun clean. */
export const FixFirstNoteKeys: Partial<
  Record<GenerationFailureCode, TranslationKey>
> = {
  [GenerationFailureCodes.PROVIDER_AUTH]: "pulls.failed.fixFirst.providerAuth",
  [GenerationFailureCodes.PROVIDER_SPEND_LIMIT]:
    "pulls.failed.fixFirst.providerSpendLimit",
  [GenerationFailureCodes.GENERATION_CONFIG]:
    "pulls.failed.fixFirst.generationConfig",
  [GenerationFailureCodes.GITHUB_ACCESS]: "pulls.failed.fixFirst.githubAccess",
};

export interface RegenerateOfferInput extends TriggerOfferInput {
  readonly errorCode: GenerationFailureCode | undefined;
}

/** The trigger route's bar, and a rerun that can help. */
export function readOffersRegenerate({
  errorCode,
  ...offer
}: RegenerateOfferInput): boolean {
  const rerunCanHelp =
    readFailureClass(errorCode) !== GenerationFailureClasses.CANNOT_HELP;
  const offered = rerunCanHelp && readOffersTrigger(offer);
  return offered;
}

export interface FailedNoteInput {
  readonly errorCode: GenerationFailureCode | undefined;
  readonly attempts: number;
  /** The card offers Regenerate, so the wait-for-a-push line gives way to it. */
  readonly offersRegenerate: boolean;
  /** Ingest queues nothing for a closed or merged PR, so a push re-queues nothing. */
  readonly prState: PrState | UnknownValue;
  /** No webhook reports on a url row: only a paste of its URL queues a run, whatever its state. */
  readonly appInstalled: boolean;
  /** A draft under a drafts-off instance: only ready for review queues a run. */
  readonly awaitsReadyForReview: boolean;
}

/** A url row reads GitHub on a reviewer's grant, so no App access is involved. */
const UrlFixFirstNoteKeys: Partial<
  Record<GenerationFailureCode, TranslationKey>
> = {
  ...FixFirstNoteKeys,
  [GenerationFailureCodes.GITHUB_ACCESS]:
    "pulls.failed.fixFirst.githubAccessUrl",
};

/** What comes next for a failed head nobody can rerun from here. */
const NoRerunNoteKeys: Record<PrState | UnknownValue, TranslationKey> = {
  [PrStates.OPEN]: "pulls.failed.requeueNote",
  [PrStates.CLOSED]: "pulls.failed.notOpenNote",
  [PrStates.MERGED]: "pulls.failed.notOpenNote",
  [UnknownValues.UNKNOWN]: "pulls.failed.requeueNote",
};

/** A spent head reruns on any trigger, a review included, not only on a new push. */
const ExhaustedNoRerunNoteKeys: Record<PrState | UnknownValue, TranslationKey> =
  {
    [PrStates.OPEN]: "pulls.failed.exhaustedRequeueNote",
    [PrStates.CLOSED]: "pulls.failed.notOpenNote",
    [PrStates.MERGED]: "pulls.failed.notOpenNote",
    [UnknownValues.UNKNOWN]: "pulls.failed.exhaustedRequeueNote",
  };

/** A held draft's pushes and reviews queue nothing; marking it ready does. */
const ReadyForReviewNoteKeys: Record<PrState | UnknownValue, TranslationKey> = {
  [PrStates.OPEN]: "pulls.failed.readyForReviewNote",
  [PrStates.CLOSED]: "pulls.failed.notOpenNote",
  [PrStates.MERGED]: "pulls.failed.notOpenNote",
  [UnknownValues.UNKNOWN]: "pulls.failed.readyForReviewNote",
};

/** Marking a held draft ready reruns its head, so a cannot-help head needs a new push first. */
const ReadyAfterPushNoteKeys: Record<PrState | UnknownValue, TranslationKey> = {
  [PrStates.OPEN]: "pulls.failed.readyForReviewAfterPushNote",
  [PrStates.CLOSED]: "pulls.failed.notOpenNote",
  [PrStates.MERGED]: "pulls.failed.notOpenNote",
  [UnknownValues.UNKNOWN]: "pulls.failed.readyForReviewAfterPushNote",
};

/** A paste reruns the head GitHub names, so a cannot-help head needs a new push first. */
function readUrlRerunNoteKey(
  errorCode: GenerationFailureCode | undefined,
): TranslationKey {
  if (readFailureClass(errorCode) === GenerationFailureClasses.CANNOT_HELP) {
    return "pulls.failed.repasteAfterPushNote";
  }
  return "pulls.failed.repasteNote";
}

function readReadyForReviewNoteKey(
  errorCode: GenerationFailureCode | undefined,
  prState: PrState | UnknownValue,
): TranslationKey {
  if (readFailureClass(errorCode) === GenerationFailureClasses.CANNOT_HELP) {
    return ReadyAfterPushNoteKeys[prState];
  }
  return ReadyForReviewNoteKeys[prState];
}

/** The facts that decide how a head nobody can rerun from here runs again. */
export type RerunNoteInput = Pick<
  FailedNoteInput,
  "prState" | "appInstalled" | "awaitsReadyForReview"
>;

type NoRerunNoteInput = RerunNoteInput & Pick<FailedNoteInput, "errorCode">;

function readNoRerunNoteKey({
  errorCode,
  appInstalled,
  prState,
  awaitsReadyForReview,
}: NoRerunNoteInput): TranslationKey {
  if (!appInstalled) {
    return readUrlRerunNoteKey(errorCode);
  }
  if (awaitsReadyForReview) {
    return readReadyForReviewNoteKey(errorCode, prState);
  }
  if (errorCode === GenerationFailureCodes.ATTEMPTS_EXHAUSTED) {
    return ExhaustedNoRerunNoteKeys[prState];
  }
  return NoRerunNoteKeys[prState];
}

/**
 * A head whose queued job used every attempt reruns as an exhausted failure
 * does: on any trigger on an open installation PR, on ready for review for a
 * held draft, on a paste for a url row.
 */
export function readSpentHeadRerunNoteKey(
  input: RerunNoteInput,
): TranslationKey {
  return readNoRerunNoteKey({
    ...input,
    errorCode: GenerationFailureCodes.ATTEMPTS_EXHAUSTED,
  });
}

function readFixFirstNote(
  t: TFunction,
  errorCode: GenerationFailureCode | undefined,
  appInstalled: boolean,
): string | undefined {
  if (errorCode === undefined) {
    return undefined;
  }
  const keys = appInstalled ? FixFirstNoteKeys : UrlFixFirstNoteKeys;
  const key = keys[errorCode];
  if (key === undefined) {
    return undefined;
  }
  return t(key);
}

/**
 * The quieter line under the reason. `attempts` counts triggers, not claims,
 * so beside the spent-claims reason it would contradict it.
 */
export function buildFailedNote(
  t: TFunction,
  input: FailedNoteInput,
): string | undefined {
  const { errorCode, attempts, offersRegenerate, appInstalled } = input;
  const parts: string[] = [];
  const fixFirst = readFixFirstNote(t, errorCode, appInstalled);
  if (fixFirst !== undefined) {
    parts.push(fixFirst);
  }
  if (errorCode !== GenerationFailureCodes.ATTEMPTS_EXHAUSTED) {
    parts.push(t("pulls.failed.attempts", { count: attempts + 1 }));
  }
  if (!offersRegenerate) {
    const noRerunKey = readNoRerunNoteKey(input);
    parts.push(t(noRerunKey));
  }
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join(" ");
}
