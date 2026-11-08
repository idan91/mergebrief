import { RequestBounds } from "contract";
import { DraftCommentStatuses, type CommentAnchorKind } from "types/comments";
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
import {
  ComposerStateKinds,
  type ComposerPlace,
  type ComposerState,
} from "./types";
import {
  armReanchorState,
  cancelComposerState,
  disarmReanchorState,
  dismissComposer,
  getComposerAnchor,
  getComposerHost,
  getReanchorDraftId,
  isComposerSaving,
  isSameComposerPlace,
  openComposerState,
  settleComposerSave,
  startComposerSave,
} from "./utils";

/** How long the announce clear tick holds before the message lands (two-tick
 * clear-then-set: an identical repeat still produces a DOM change, so the
 * live region re-announces and the toast hide timer restarts). */
export const ANNOUNCE_CLEAR_MS = 30;

/**
 * @description Ephemeral review-flow UI state: composer anchoring,
 * risk-disposition targets/selection, and the page toast. Deliberately
 * OUTSIDE the persisted Review Session snapshot; none of this survives a
 * reload.
 */
export interface ReviewFlowState {
  /** The Brief this store belongs to; absent keeps composer text in memory only. */
  briefId: string | undefined;
  /**
   * The one composer on the page, or the carried draft waiting for the next
   * row pick to place it. The composer closes on write SUCCESS, not on
   * click, and a cancel is refused while the write is in flight.
   */
  composer: ComposerState;
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
    host: string,
  ) => void;
  /** The reviewer's cancel; refused and announced while the write is in flight. */
  cancelComposer: () => void;
  /** The host went away: closes even mid-save, and that save's settle is dropped. */
  dismissComposer: () => void;
  /**
   * Counts a mounted surface that can show a composer of this kind under
   * this host; the returned release dismisses a composer it showed once no
   * such surface is left. Checked a microtask later, so a remount or a
   * StrictMode re-run inside one commit keeps the composer.
   */
  holdComposerHost: (anchorKind: CommentAnchorKind, host: string) => () => void;
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
  /** Answers whether the edit landed; "updated" is announced only then. */
  updateComment: (commentId: string, body: string) => Promise<boolean>;
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

function initialReviewFlowState(briefId: string | undefined): ReviewFlowState {
  return {
    briefId,
    composer: { kind: ComposerStateKinds.CLOSED },
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
  briefId?: string,
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
    let saveToken = 0;
    /** Every save still in flight, a dismissed composer's included. */
    const pendingSaves = new Map<number, ComposerPlace>();
    const heldHosts = new Map<string, number>();
    const dismissUnheldHost = (anchorKind: CommentAnchorKind, host: string) => {
      const { composer } = get();
      const shown =
        getComposerHost(composer) === host &&
        getComposerAnchor(composer)?.kind === anchorKind;
      if (shown) {
        set({ composer: dismissComposer(composer) });
      }
    };
    /** True when a write is in flight, after saying why the action waits. */
    const refuseWhileSaving = () => {
      if (!isComposerSaving(get().composer)) {
        return false;
      }
      announce(translate("review.announce.commentStillSaving"));
      return true;
    };
    /** A place whose dismissed save is in flight would reopen on the text it sends. */
    const refuseWhilePlaceSaving = (place: ComposerPlace) => {
      const placeSaving = [...pendingSaves.values()].some((saved) =>
        isSameComposerPlace(saved, place),
      );
      if (placeSaving) {
        announce(translate("review.announce.commentStillSaving"));
      }
      return placeSaving;
    };
    return {
      ...initialReviewFlowState(briefId),
      actions: {
        openComposer(anchor, disabledReason, host) {
          if (disabledReason !== undefined) {
            announce(disabledReason);
            return;
          }
          if (refuseWhileSaving()) {
            return;
          }
          // Placement branches HERE, not at the call sites: every gesture that
          // picks rows already ends in this one action.
          const { composer } = get();
          const reanchoring = getReanchorDraftId(composer);
          const reanchorsDraft =
            reanchoring !== undefined && isLineCommentAnchor(anchor);
          if (reanchorsDraft) {
            if (anchor.file.length > RequestBounds.PATH_LENGTH) {
              announce(translate("review.announce.reanchorPathTooLong"));
              return;
            }
            set({ composer: disarmReanchorState(composer) });
            // A draft deleted while placement was armed leaves nothing to
            // move: the gesture falls through to a fresh composer rather than
            // announcing a placement that never happened.
            if (session.reanchorComment(reanchoring, anchor)) {
              announce(translate("review.announce.commentReanchored"));
              return;
            }
          }
          if (refuseWhilePlaceSaving({ anchor, host })) {
            return;
          }
          // A file comment places no draft: it ends re-anchoring, and the
          // armed draft keeps its lines.
          get().actions.cancelReanchor();
          const current = get().composer;
          set({ composer: openComposerState(current, anchor, host) });
        },
        cancelComposer() {
          if (refuseWhileSaving()) {
            return;
          }
          const { composer } = get();
          set({ composer: cancelComposerState(composer) });
        },
        dismissComposer() {
          const { composer } = get();
          set({ composer: dismissComposer(composer) });
        },
        holdComposerHost(anchorKind, host) {
          const key = `${anchorKind}:${host}`;
          heldHosts.set(key, (heldHosts.get(key) ?? 0) + 1);
          return () => {
            heldHosts.set(key, (heldHosts.get(key) ?? 1) - 1);
            queueMicrotask(() => {
              if ((heldHosts.get(key) ?? 0) > 0) {
                return;
              }
              heldHosts.delete(key);
              dismissUnheldHost(anchorKind, host);
            });
          };
        },
        startReanchor(draftId, disabledReason) {
          // Armed twice on the same draft = disarmed, so an armed state the
          // reviewer changed their mind about has a way out that is not
          // "pick a row you did not mean".
          const { composer } = get();
          if (getReanchorDraftId(composer) === draftId) {
            get().actions.cancelReanchor();
            return;
          }
          if (disabledReason !== undefined) {
            announce(disabledReason);
            return;
          }
          if (refuseWhileSaving()) {
            return;
          }
          set({
            composer: armReanchorState(composer, draftId),
            lineSelection: null,
          });
          // The mode banner shows it; the hidden region only says it.
          announceQuietly(translate("review.announce.reanchorArmed"));
        },
        cancelReanchor() {
          const { composer } = get();
          if (getReanchorDraftId(composer) === undefined) {
            return;
          }
          set({ composer: disarmReanchorState(composer) });
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
          const current = get().composer;
          if (current.kind !== ComposerStateKinds.OPEN) {
            return false;
          }
          saveToken += 1;
          const token = saveToken;
          pendingSaves.set(token, { anchor, host: current.host });
          set({ composer: startComposerSave(current, token) });
          let saved = false;
          try {
            saved = await session.saveComment({
              anchor,
              body: trimmed,
              status: DraftCommentStatuses.DRAFT,
              collapsed: false,
            });
            return saved;
          } finally {
            pendingSaves.delete(token);
            const { composer } = get();
            set({ composer: settleComposerSave(composer, token, saved) });
            // A dismissed composer's draft still landed: say so.
            if (saved) {
              announce(translate("review.announce.commentAdded"));
            }
          }
        },
        async updateComment(commentId, body) {
          const trimmed = body.trim();
          if (!trimmed) {
            announce(translate("review.announce.commentEmpty"));
            return false;
          }
          const updated = await session.updateComment(commentId, trimmed);
          if (updated) {
            announce(translate("review.announce.commentUpdated"));
          }
          return updated;
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
            const expanded =
              state.expandedConversations.get(chunkKey) ?? new Set<number>();
            next.set(chunkKey, toggleSet(expanded, threadId));
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
