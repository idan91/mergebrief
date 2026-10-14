import { RequestBounds } from "contract";
import { DraftCommentStatuses } from "types/comments";
import type { TranslationKey } from "i18n";
import { createStore, type StoreApi } from "zustand/vanilla";

import { toggleSet } from "@web/utils/collections";
import {
  isLineCommentAnchor,
  type CommentAnchor,
  type LineSelection,
} from "../../utils/comments";
import type { DismissTarget, EvidenceTarget } from "../../utils/state";
import type { ReviewSessionActions } from "../store";

/** How long the announce clear tick holds before the message lands (two-tick
 * clear-then-set: an identical repeat still produces a DOM change, so the
 * live region re-announces and the toast hide timer restarts). */
const ANNOUNCE_CLEAR_MS = 30;

/**
 * @description Ephemeral review-flow UI state: composer anchoring,
 * risk-disposition targets/selection, and the page toast. Deliberately
 * OUTSIDE the persisted Review Session snapshot; none of this survives a
 * reload.
 */
export interface ReviewFlowState {
  composerAnchor: CommentAnchor | null;
  /**
   * The chunk whose table shows the composer. Usually the anchor's own
   * chunk; a row picked inside a sibling span anchors to the owner but the
   * composer opens where the reviewer clicked, and only there.
   */
  composerHost: string | null;
  /**
   * A carried draft is waiting for its new home: the next row the reviewer
   * picks re-anchors THAT draft instead of opening a fresh composer.
   */
  reanchorDraftId: string | null;
  /**
   * A staged-draft write is in flight. The composer closes on write SUCCESS,
   * not on click: that buys one "Saving…" round trip and costs no
   * unsaved-marker state, no retry button and no half-applied draft.
   */
  composerSaving: boolean;
  dismissTarget: DismissTarget | null;
  evidenceTarget: EvidenceTarget | null;
  /**
   * The lines a reader picked to share or comment on, at most one range in
   * one chunk. Separate from the composer anchor: the composer stays out of
   * the URL, and the selection outlives the composer closing.
   */
  lineSelection: LineSelection | null;
  /** Open inline conversation threads per file-qualified chunk key
   * (`file#chunkId`; a bare chunk id can collide across diff sources).
   * Store-owned, not card state: a virtualized card unmounts offscreen and
   * its disclosure state must survive the round trip. */
  expandedConversations: ReadonlyMap<string, ReadonlySet<number>>;
  /** The free-text review-comment draft: survives the submit modal closing,
   * deliberately not a reload. */
  reviewComment: string;
  selectedRiskFlags: ReadonlySet<string>;
  /** The submit failure copy for this brief; empty = none. */
  submitError: string;
  /** The receipt note after a degraded post, kept past the toast; empty = none. */
  submitNote: string;
  /** The page live-region message; empty = hidden. */
  toast: string;
  /** The hidden live-region message for a state change the page already shows; empty = none. */
  liveMessage: string;
}

/**
 * Actions are property-style function types (not method shorthand): they are
 * plain closures with no `this`, and callers destructure them freely.
 */
export interface ReviewFlowActions {
  /**
   * @description Opens the composer at the anchor, unless the caller passes
   * the reason composition is read-only, in which case the reason is announced
   * instead (surface WHY through the live region, never a dead control).
   */
  openComposer: (
    anchor: CommentAnchor,
    disabledReason: string | undefined,
    host?: string,
  ) => void;
  cancelComposer: () => void;
  /**
   * Arms re-anchoring for a carried draft; the next picked row places it. A
   * read-only reason from the caller is announced instead of arming.
   */
  startReanchor: (draftId: string, disabledReason: string | undefined) => void;
  /** Disarms re-anchoring; a no-op when nothing is armed. */
  cancelReanchor: () => void;
  /**
   * @description Trim-and-save a draft at the anchor; an empty body announces
   * and keeps the composer open. The composer closes when the WRITE lands;
   * a failure leaves it open holding its text, with the same Save available.
   */
  saveComment: (anchor: CommentAnchor, body: string) => Promise<boolean>;
  updateComment: (commentId: string, body: string) => void;
  deleteComment: (commentId: string) => void;
  toggleComment: (commentId: string) => void;
  /** @description Flip one inline thread's disclosure under its chunk key. */
  toggleConversationThread: (chunkKey: string, threadId: number) => void;
  /** @description Replaces the selection whole; a pick never spans chunks. */
  selectLines: (selection: LineSelection) => void;
  clearLineSelection: () => void;
  setDismissTarget: (target: DismissTarget | null) => void;
  setEvidenceTarget: (target: EvidenceTarget | null) => void;
  toggleRiskFlag: (flagId: string) => void;
  /**
   * @description Group toggle: every open member selected → deselect all;
   * otherwise select all. An empty group is a no-op.
   */
  toggleRiskGroup: (flagIds: readonly string[]) => void;
  /** @description Drop the given flags from the selection (post-disposition sweep). */
  clearRiskSelection: (flagIds: readonly string[]) => void;
  setReviewComment: (body: string) => void;
  /**
   * @description Clears the review-comment draft only when it still equals
   * the text a successful submit SHIPPED (capture-at-initiation): an edit
   * made while the request was in flight is never silently dropped.
   */
  consumeReviewComment: (sent: string) => void;
  /**
   * @description Page live-region announce, clear-then-set: an identical
   * repeat message still produces a DOM change and restarts the hide timer.
   */
  announce: (message: string) => void;
  /**
   * @description The same clear-then-set into the hidden live region, for a
   * change the page shows on its own, such as a line selection.
   */
  announceQuietly: (message: string) => void;
  setSubmitError: (copy: string) => void;
  setSubmitNote: (copy: string) => void;
  clearToast: () => void;
}

export interface ReviewFlowStoreValue extends ReviewFlowState {
  actions: ReviewFlowActions;
}

export type ReviewFlowStore = StoreApi<ReviewFlowStoreValue>;

/**
 * @description The session-store actions the flow delegates comment CRUD to:
 * a narrow pick so the flow cannot reach dispositions or submit bookkeeping.
 */
export type ReviewFlowSessionActions = Pick<
  ReviewSessionActions,
  | "saveComment"
  | "updateComment"
  | "deleteComment"
  | "toggleComment"
  | "reanchorComment"
>;

function resolveHost(
  anchor: CommentAnchor,
  host: string | undefined,
): string | null {
  if (host !== undefined) {
    return host;
  }
  return isLineCommentAnchor(anchor) ? anchor.chunkId : null;
}

function initialReviewFlowState(): ReviewFlowState {
  return {
    composerAnchor: null,
    composerHost: null,
    composerSaving: false,
    reanchorDraftId: null,
    dismissTarget: null,
    evidenceTarget: null,
    lineSelection: null,
    expandedConversations: new Map(),
    reviewComment: "",
    selectedRiskFlags: new Set(),
    submitError: "",
    submitNote: "",
    toast: "",
    liveMessage: "",
  };
}

/**
 * Ephemeral review-flow store (zustand-in-context, the ReviewSessionProvider
 * pattern): created once per screen mount, never a module singleton. The
 * comment CRUD actions delegate the durable half to the injected session
 * actions and keep the UI half (composer close, toast copy) here: one call
 * site per gesture, state next to the action that mutates it.
 */
export function createReviewFlowStore(
  session: ReviewFlowSessionActions,
  /**
   * Resolver called at ANNOUNCE time, never captured copy: `useTranslation`'s
   * `t` is pinned to the mount-time language (`getFixedT`), so holding one
   * here would keep announcing English after a locale switch.
   */
  translate: (key: TranslationKey) => string,
): ReviewFlowStore {
  return createStore<ReviewFlowStoreValue>((set, get) => {
    let announceTimer: number | undefined;
    const announce = (message: string) => {
      // Clear tick now, message on the next: repeat messages re-announce.
      window.clearTimeout(announceTimer);
      set({ toast: "" });
      announceTimer = window.setTimeout(
        () => set({ toast: message }),
        ANNOUNCE_CLEAR_MS,
      );
    };
    let quietTimer: number | undefined;
    const announceQuietly = (message: string) => {
      window.clearTimeout(quietTimer);
      set({ liveMessage: "" });
      quietTimer = window.setTimeout(
        () => set({ liveMessage: message }),
        ANNOUNCE_CLEAR_MS,
      );
    };
    return {
      ...initialReviewFlowState(),
      actions: {
        openComposer(anchor, disabledReason, host) {
          if (disabledReason !== undefined) {
            announce(disabledReason);
            return;
          }
          // Placement branches HERE, not at the call sites: every gesture that
          // picks rows already ends in this one action.
          const reanchoring = get().reanchorDraftId;
          if (reanchoring !== null) {
            if (anchor.file.length > RequestBounds.PATH_LENGTH) {
              announce(translate("review.announce.reanchorPathTooLong"));
              return;
            }
            set({ reanchorDraftId: null });
            // A draft deleted while placement was armed leaves nothing to
            // move: the gesture falls through to a fresh composer rather than
            // announcing a placement that never happened.
            if (session.reanchorComment(reanchoring, anchor)) {
              announce(translate("review.announce.commentReanchored"));
              return;
            }
          }
          set({
            composerAnchor: anchor,
            composerHost: resolveHost(anchor, host),
          });
        },
        cancelComposer() {
          set({
            composerAnchor: null,
            composerHost: null,
            composerSaving: false,
            reanchorDraftId: null,
          });
        },
        startReanchor(draftId, disabledReason) {
          // Armed twice on the same draft = disarmed, so an armed state the
          // reviewer changed their mind about has a way out that is not
          // "pick a row you did not mean".
          if (get().reanchorDraftId === draftId) {
            get().actions.cancelReanchor();
            return;
          }
          if (disabledReason !== undefined) {
            announce(disabledReason);
            return;
          }
          set({
            composerAnchor: null,
            composerHost: null,
            lineSelection: null,
            reanchorDraftId: draftId,
          });
          // The mode banner shows it; the hidden region only says it.
          announceQuietly(translate("review.announce.reanchorArmed"));
        },
        cancelReanchor() {
          if (get().reanchorDraftId === null) {
            return;
          }
          set({ reanchorDraftId: null });
          announceQuietly(translate("review.announce.reanchorCancelled"));
        },
        async saveComment(anchor, body) {
          const trimmed = body.trim();
          if (!trimmed) {
            announce(translate("review.announce.commentEmpty"));
            return false;
          }
          // One in-flight save per composer: a disabled control, not a
          // protocol. A second click while the first is unresolved could
          // stage the same draft twice.
          if (get().composerSaving) {
            return false;
          }
          set({ composerSaving: true });
          try {
            const saved = await session.saveComment({
              anchor,
              body: trimmed,
              status: DraftCommentStatuses.DRAFT,
              collapsed: false,
            });
            if (saved) {
              set({ composerAnchor: null, composerHost: null });
              announce(translate("review.announce.commentAdded"));
            }
            return saved;
          } finally {
            set({ composerSaving: false });
          }
        },
        updateComment(commentId, body) {
          const trimmed = body.trim();
          if (!trimmed) {
            announce(translate("review.announce.commentEmpty"));
            return;
          }
          session.updateComment(commentId, trimmed);
          announce(translate("review.announce.commentUpdated"));
        },
        deleteComment(commentId) {
          session.deleteComment(commentId);
          announce(translate("review.announce.commentDeleted"));
        },
        toggleComment(commentId) {
          session.toggleComment(commentId);
        },
        toggleConversationThread(chunkKey, threadId) {
          set((state) => {
            const next = new Map(state.expandedConversations);
            next.set(
              chunkKey,
              toggleSet(
                state.expandedConversations.get(chunkKey) ?? new Set(),
                threadId,
              ),
            );
            return { expandedConversations: next };
          });
        },
        selectLines(selection) {
          set({ lineSelection: selection });
        },
        clearLineSelection() {
          if (get().lineSelection === null) {
            return;
          }
          set({ lineSelection: null });
        },
        setDismissTarget(target) {
          set({ dismissTarget: target });
        },
        setEvidenceTarget(target) {
          set({ evidenceTarget: target });
        },
        toggleRiskFlag(flagId) {
          set((state) => ({
            selectedRiskFlags: toggleSet(state.selectedRiskFlags, flagId),
          }));
        },
        toggleRiskGroup(flagIds) {
          if (flagIds.length === 0) {
            return;
          }
          set((state) => {
            const allSelected = flagIds.every((id) =>
              state.selectedRiskFlags.has(id),
            );
            const next = new Set(state.selectedRiskFlags);
            for (const id of flagIds) {
              if (allSelected) {
                next.delete(id);
              } else {
                next.add(id);
              }
            }
            return { selectedRiskFlags: next };
          });
        },
        clearRiskSelection(flagIds) {
          if (flagIds.length === 0) {
            return;
          }
          set((state) => {
            const next = new Set(state.selectedRiskFlags);
            for (const id of flagIds) {
              next.delete(id);
            }
            return { selectedRiskFlags: next };
          });
        },
        setReviewComment(body) {
          set({ reviewComment: body });
        },
        consumeReviewComment(sent) {
          if (get().reviewComment === sent) {
            set({ reviewComment: "" });
          }
        },
        announce,
        announceQuietly,
        clearToast() {
          set({ toast: "" });
        },
        setSubmitError(copy) {
          set({ submitError: copy });
        },
        setSubmitNote(copy) {
          set({ submitNote: copy });
        },
      },
    };
  });
}
