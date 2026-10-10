import type { TranslationKey } from "i18n";

import type { ShortcutSection } from "@web/components/ShortcutsModal";

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

export const TOAST_VISIBLE_MS = 4200;
