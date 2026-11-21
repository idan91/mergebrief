import {
  CommitStatusStates,
  type CheckRun,
  type CommitStatus,
  type SubmittedReview,
} from "github";
import { z } from "zod/v4";
import {
  ReviewVerdictStates,
  type ReviewVerdictState,
} from "types/conversation";
import {
  BotStates,
  BotVerdicts,
  TriggerConditionKinds,
  type BotState,
  type BotVerdict,
  type ReviewBot,
  type UnmetBot,
  type UnmetPlainCondition,
} from "types/trigger-conditions";
import type { Mutable } from "types/utils";

import { CLAUDE_NO_ISSUES_TITLE, REVIEW_BOT_ACCOUNTS } from "./consts";
import type { ConditionFacts, KindCheckInput, ReviewBotAccount } from "./types";
import { findLatestRun, isReviewBot } from "./utils";

/** What one bot left on the head, from its own accounts only. */
interface BotReports {
  readonly runs: readonly CheckRun[];
  readonly statuses: readonly CommitStatus[];
  /** Submitted against the head, oldest first. */
  readonly reviews: readonly SubmittedReview[];
}

/** Why a bot holds; `issues` only on `issues`. */
interface BotHold {
  readonly state: BotState;
  readonly issues?: number;
}

const SEVERITY_LINE_PATTERN = /^<!--\s*bughunter-severity:\s*(\{.*\})\s*-->$/;
const severitySchema = z.object({ normal: z.int().nonnegative() });

function collectBotReports(
  account: ReviewBotAccount,
  facts: ConditionFacts,
): BotReports {
  const { reports, headSha } = facts;
  const runs = reports.checkRuns.filter((run) => {
    const fromBotApp =
      account.appId !== undefined && run.appId === account.appId;
    return fromBotApp;
  });
  const statuses = reports.statuses.filter(
    (status) => status.creatorId === account.userId,
  );
  const reviews = reports.reviews.filter((review) => {
    const botReviewOfHead =
      review.authorId === account.userId && review.commitId === headSha;
    return botReviewOfHead;
  });
  return { runs, statuses, reviews };
}

/** Any end of work on the head counts, whatever its outcome. */
function hasFinished(reports: BotReports): boolean {
  const ranToEnd = reports.runs.some((run) => run.completed);
  const statusEnded = reports.statuses.some(
    (status) => status.state !== CommitStatusStates.PENDING,
  );
  const reviewed = reports.reviews.length > 0;
  const finished = ranToEnd || statusEnded || reviewed;
  return finished;
}

function hasStarted(reports: BotReports): boolean {
  const runStarted = reports.runs.some((run) => !run.completed);
  const statusReported = reports.statuses.length > 0;
  const started = runStarted || statusReported;
  return started;
}

/**
 * Where an unfinished bot stands. A bot with an App reports through check
 * runs or statuses, so either refused read hides it; Copilot reports only
 * through reviews, which need no extra permission.
 */
function readProgressHold(
  account: ReviewBotAccount,
  reports: BotReports,
  facts: ConditionFacts,
): BotHold {
  if (hasStarted(reports)) {
    return { state: BotStates.RUNNING };
  }
  const { checkRunsForbidden, statusesForbidden } = facts.reports;
  const readRefused = checkRunsForbidden || statusesForbidden;
  if (readRefused && account.appId !== undefined) {
    return { state: BotStates.PERMISSION_MISSING };
  }
  return { state: BotStates.NOT_STARTED };
}

/** The review states that decide a verdict; a comment decides nothing. */
const VERDICT_REVIEW_STATES: ReadonlySet<ReviewVerdictState> = new Set([
  ReviewVerdictStates.APPROVED,
  ReviewVerdictStates.CHANGES_REQUESTED,
  ReviewVerdictStates.DISMISSED,
]);

/**
 * The bot's latest approval, change request or dismissed review decides: a
 * later comment leaves it standing, and a dismissal never lets an older
 * approval stand again.
 */
function readApprovalHold(reports: BotReports): BotHold | undefined {
  const verdicts = reports.reviews.filter((review) =>
    VERDICT_REVIEW_STATES.has(review.state),
  );
  if (verdicts.at(-1)?.state === ReviewVerdictStates.APPROVED) {
    return undefined;
  }
  return { state: BotStates.NOT_APPROVED };
}

/** The `normal` count on the details' last line; `undefined` when absent or unreadable. */
function readNormalFindings(text: string | undefined): number | undefined {
  const lines = text?.trimEnd().split("\n") ?? [];
  const lastLine = lines.at(-1)?.trim() ?? "";
  const json = SEVERITY_LINE_PATTERN.exec(lastLine)?.[1];
  if (json === undefined) {
    return undefined;
  }
  try {
    const parsed = severitySchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data.normal : undefined;
  } catch {
    return undefined;
  }
}

function isAnyRun(): boolean {
  return true;
}

/**
 * Claude's latest run on the head decides: while it runs, the bot is running;
 * once done, its no-issues title, or no `normal` findings on its severity
 * line. A skipped run, a repeat it did not run, or a missing line gives no
 * verdict.
 */
function readCleanHold(
  reports: BotReports,
  facts: ConditionFacts,
): BotHold | undefined {
  if (facts.reports.checkRunsForbidden) {
    return { state: BotStates.PERMISSION_MISSING };
  }
  const latest = findLatestRun(reports.runs, isAnyRun);
  if (latest?.completed === false) {
    return { state: BotStates.RUNNING };
  }
  if (latest?.title === CLAUDE_NO_ISSUES_TITLE) {
    return undefined;
  }

  const normal = readNormalFindings(latest?.text);
  if (normal === undefined) {
    return { state: BotStates.NO_VERDICT };
  }
  if (normal === 0) {
    return undefined;
  }
  return { state: BotStates.ISSUES, issues: normal };
}

function readBotHold(
  bot: ReviewBot,
  verdict: BotVerdict,
  facts: ConditionFacts,
): BotHold | undefined {
  const account = REVIEW_BOT_ACCOUNTS[bot];
  const reports = collectBotReports(account, facts);
  if (!hasFinished(reports)) {
    return readProgressHold(account, reports, facts);
  }

  switch (verdict) {
    case BotVerdicts.APPROVED:
      return readApprovalHold(reports);
    case BotVerdicts.CLEAN:
      return readCleanHold(reports, facts);
    case BotVerdicts.FINISHED:
      return undefined;
  }
}

/** One item per unmet bot, in the order the setting lists them. */
export function checkBots({
  value,
  setBy,
  facts,
}: KindCheckInput<typeof TriggerConditionKinds.BOTS>): UnmetPlainCondition[] {
  const unmet: UnmetPlainCondition[] = [];
  for (const [bot, verdict] of Object.entries(value)) {
    const configuredBot = isReviewBot(bot) && verdict !== undefined;
    if (!configuredBot) {
      continue;
    }
    const hold = readBotHold(bot, verdict, facts);
    if (hold === undefined) {
      continue;
    }
    const item: Mutable<UnmetBot> = {
      kind: TriggerConditionKinds.BOTS,
      setBy,
      bot,
      verdict,
      state: hold.state,
    };
    if (hold.issues !== undefined) {
      item.issues = hold.issues;
    }
    unmet.push(item);
  }
  return unmet;
}
