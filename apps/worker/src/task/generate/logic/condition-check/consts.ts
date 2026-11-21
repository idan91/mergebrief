import { ReviewBots, type ReviewBot } from "types/trigger-conditions";

import type { ReviewBotAccount } from "./types";

/**
 * Each bot's App and bot-user ids. Any App with write access can post a run
 * or status under a bot's name, so a bot is known by these ids, never a name.
 */
export const REVIEW_BOT_ACCOUNTS: Readonly<
  Record<ReviewBot, ReviewBotAccount>
> = {
  [ReviewBots.UNBLOCKED]: { appId: 166_219n, userId: 98_133_410n },
  [ReviewBots.CODERABBIT]: { appId: 347_564n, userId: 136_622_811n },
  [ReviewBots.CLAUDE]: { appId: 1_236_702n, userId: 209_825_114n },
  [ReviewBots.GREPTILE]: { appId: 867_647n, userId: 165_735_046n },
  [ReviewBots.COPILOT]: { userId: 175_728_472n },
};

/** Claude Code Review's check-run title when it found nothing. */
export const CLAUDE_NO_ISSUES_TITLE = "Code review found no issues";
