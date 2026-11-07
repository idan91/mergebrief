import type { TranslationKey } from "i18n";

import { IconNames, type IconName } from "@web/components/Icon/types";
import type { ShortcutSection } from "@web/components/ShortcutsModal";
import {
  PrStateBadgeVariants,
  SupportingCollapseStates,
  type PrStateBadgeVariant,
  type SupportingCollapseState,
} from "./types";

/** The state glyphs, the same drawings Home's row end uses. */
export const PR_STATE_BADGE_ICONS: Record<PrStateBadgeVariant, IconName> = {
  [PrStateBadgeVariants.OPEN]: IconNames.GIT_PULL_REQUEST,
  [PrStateBadgeVariants.DRAFT]: IconNames.CIRCLE_DASHED,
  [PrStateBadgeVariants.MERGED]: IconNames.GIT_MERGE,
  [PrStateBadgeVariants.CLOSED]: IconNames.X_CIRCLE,
};

export const PR_STATE_BADGE_LABEL_KEYS: Record<
  PrStateBadgeVariant,
  TranslationKey
> = {
  [PrStateBadgeVariants.OPEN]: "brief.stateBadge.open",
  [PrStateBadgeVariants.DRAFT]: "brief.stateBadge.draft",
  [PrStateBadgeVariants.MERGED]: "brief.stateBadge.merged",
  [PrStateBadgeVariants.CLOSED]: "brief.stateBadge.closed",
};

// Esc is listed in both sections on purpose: one line says one thing.
export const BRIEF_SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    id: "general",
    headingKey: "brief.shortcuts.sectionGeneral",
    shortcuts: [
      { keys: ["J"], descriptionKey: "brief.shortcuts.nextChunk" },
      { keys: ["K"], descriptionKey: "brief.shortcuts.previousChunk" },
      { keys: ["Shift", "J"], descriptionKey: "brief.shortcuts.nextGroup" },
      { keys: ["Shift", "K"], descriptionKey: "brief.shortcuts.previousGroup" },
      { keys: ["C"], descriptionKey: "brief.shortcuts.jumpConversation" },
      { keys: ["S"], descriptionKey: "brief.shortcuts.toggleSidebar" },
      { keys: ["R"], descriptionKey: "brief.shortcuts.quoteThread" },
      { keys: ["D"], descriptionKey: "brief.shortcuts.toggleDiffView" },
      { keys: ["?"], descriptionKey: "brief.shortcuts.toggleShortcuts" },
      { keys: ["Esc"], descriptionKey: "brief.shortcuts.closeDialog" },
    ],
  },
  {
    id: "focus-mode",
    headingKey: "brief.shortcuts.sectionFocusMode",
    shortcuts: [
      { keys: ["Z"], descriptionKey: "brief.shortcuts.focusMode" },
      { keys: ["V"], descriptionKey: "brief.shortcuts.markViewed" },
      { keys: ["S"], descriptionKey: "brief.shortcuts.toggleFocusPanel" },
      { keys: ["Esc"], descriptionKey: "brief.shortcuts.exitFocusMode" },
    ],
  },
];

/** A chunk with more changed lines than this starts closed, like GitHub's large diffs. */
export const LARGE_CHUNK_CHANGED_LINES = 750;

/** The re-anchor banner's hint; inert rows in other files point at it. */
export const REANCHOR_HINT_ID = "reanchor-hint";

/**
 * Own-draft composer block on a stale view: post-now exists only at the
 * current head, so a stale-staged draft would have no exit, unlike reviewer
 * views, whose exit is Submit behind the ack.
 */
export const OWN_DRAFT_STALE_COMPOSER_REASON_KEY: TranslationKey =
  "brief.screen.staleRevisionReason";

/** Without a review there is no session to save work to. */
export const NO_REVIEW_REASON_KEY: TranslationKey =
  "brief.screen.fileBriefReadOnly";

export const SESSION_FROZEN_REASON_KEY: TranslationKey =
  "brief.screen.sessionFrozen";

/** A commit or blob sha as the page abbreviates it. */
export const SHORT_SHA_LENGTH = 7;

/**
 * The terminal-action CTA, Submit review or Mark ready, which
 * `SubmitReviewCta` and `MarkReadyCta` mark with `data-terminal-slot`;
 * orphaned focus is rescued onto it. Never a styling or test hook.
 */
export const TERMINAL_SLOT_SELECTOR = "[data-terminal-slot]";

/**
 * 14px from the trigger's bottom edge: the trigger sits inside the bar's
 * 8px inset (+1px border), leaving a ~5px visible gap below the bar.
 */
export const DISCLOSURE_OFFSET_PX = 14;

/** The collapse toggle's aria-pressed per collapse state, mixed included. */
export const COLLAPSE_PRESSED: Record<
  SupportingCollapseState,
  boolean | "mixed"
> = {
  [SupportingCollapseStates.NONE]: false,
  [SupportingCollapseStates.SOME]: "mixed",
  [SupportingCollapseStates.ALL]: true,
};
