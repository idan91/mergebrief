import { createStore, type StoreApi } from "zustand/vanilla";

import { toggleSet } from "@web/utils/collections";
import type { CommentAnchor, ReviewComment } from "../../utils/comments";
import type { DismissTarget, EvidenceTarget } from "../../utils/state";
import type { MindMapActions } from "../store";

/** How long the announce clear tick holds before the message lands (two-tick
 * clear-then-set: an identical repeat still produces a DOM change, so the
 * live region re-announces and the toast hide timer restarts). */
const ANNOUNCE_CLEAR_MS = 30;

/**
 * @description Posture the screen syncs in every render-relevant change:
 * read-only reasons, own-draft mirror, and the post-now family. None of it is
 * owned here — the screen derives it from route plans and module registries;
 * the store is its distribution channel to the card tree.
 */
export interface ReviewFlowPosture {
  /** Read-only reason for the comment affordances (BRIEF-24); undefined = writable. */
  composerDisabledReason: string | undefined;
  /** Own-draft state (BRIEF-43): risk flags render as a read-only mirror. */
  flagsReadOnly: boolean;
  /** Comment ids with a post-now request in flight (registry-subscribed). */
  postingCommentIds: ReadonlySet<string>;
  /** Wait-shaped reason every Post is blocked right now (submit in flight). */
  postBlockedExternally: string | undefined;
  /** Post a staged draft NOW (BRIEF-43 own-draft, current head); undefined hides Post. */
  postComment: ((comment: ReviewComment) => void) | undefined;
}

/**
 * @description Ephemeral review-flow UI state (ADR 0022's transient half):
 * composer anchoring, risk-disposition targets/selection, and the page toast.
 * Deliberately OUTSIDE the persisted Mind-Map snapshot — none of this
 * survives a reload.
 */
export interface ReviewFlowState extends ReviewFlowPosture {
  composerAnchor: CommentAnchor | null;
  dismissTarget: DismissTarget | null;
  evidenceTarget: EvidenceTarget | null;
  /** The free-text review-comment draft (BRIEF-137): survives the submit
   * modal closing, deliberately not a reload. */
  reviewComment: string;
  selectedRiskFlags: ReadonlySet<string>;
  /** The page live-region message; empty = hidden. */
  toast: string;
}

/**
 * Actions are property-style function types (not method shorthand): they are
 * plain closures with no `this`, and callers destructure them freely.
 */
export interface ReviewFlowActions {
  /**
   * @description Opens the composer at the anchor — unless the read-only
   * posture blocks composition, in which case the reason is announced instead
   * (BRIEF-24: surface WHY through the live region, never a dead control).
   */
  openComposer: (anchor: CommentAnchor) => void;
  cancelComposer: () => void;
  /**
   * @description Trim-and-save a draft at the anchor; an empty body announces
   * and keeps the composer open. Success closes the composer.
   */
  saveComment: (anchor: CommentAnchor, body: string) => void;
  updateComment: (commentId: string, body: string) => void;
  deleteComment: (commentId: string) => void;
  toggleComment: (commentId: string) => void;
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
   * the text a successful submit SHIPPED (capture-at-initiation, BRIEF-23):
   * an edit made while the request was in flight is never silently dropped.
   */
  consumeReviewComment: (sent: string) => void;
  /**
   * @description Page live-region announce, clear-then-set: an identical
   * repeat message still produces a DOM change and restarts the hide timer.
   */
  announce: (message: string) => void;
  clearToast: () => void;
}

export interface ReviewFlowStoreValue extends ReviewFlowState {
  actions: ReviewFlowActions;
}

export type ReviewFlowStore = StoreApi<ReviewFlowStoreValue>;

/**
 * @description The session-store actions the flow delegates comment CRUD to —
 * a narrow pick so the flow cannot reach dispositions or submit bookkeeping.
 */
export type ReviewFlowSessionActions = Pick<
  MindMapActions,
  "saveComment" | "updateComment" | "deleteComment" | "toggleComment"
>;

export function initialReviewFlowState(
  posture: ReviewFlowPosture,
): ReviewFlowState {
  return {
    ...posture,
    composerAnchor: null,
    dismissTarget: null,
    evidenceTarget: null,
    reviewComment: "",
    selectedRiskFlags: new Set(),
    toast: "",
  };
}

/**
 * Ephemeral review-flow store (zustand-in-context, the MindMapProvider
 * pattern): created once per screen mount, never a module singleton. The
 * comment CRUD actions delegate the durable half to the injected session
 * actions and keep the UI half (composer close, toast copy) here — one call
 * site per gesture, state next to the action that mutates it.
 */
export function createReviewFlowStore(
  session: ReviewFlowSessionActions,
  posture: ReviewFlowPosture,
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
    return {
      ...initialReviewFlowState(posture),
      actions: {
        openComposer(anchor) {
          const reason = get().composerDisabledReason;
          if (reason !== undefined) {
            announce(reason);
            return;
          }
          set({ composerAnchor: anchor });
        },
        cancelComposer() {
          set({ composerAnchor: null });
        },
        saveComment(anchor, body) {
          const trimmed = body.trim();
          if (!trimmed) {
            announce("Comment cannot be empty.");
            return;
          }
          session.saveComment({
            anchor,
            body: trimmed,
            status: "draft",
            collapsed: false,
          });
          set({ composerAnchor: null });
          announce("Draft comment added to this review.");
        },
        updateComment(commentId, body) {
          const trimmed = body.trim();
          if (!trimmed) {
            announce("Comment cannot be empty.");
            return;
          }
          session.updateComment(commentId, trimmed);
          announce("Draft comment updated.");
        },
        deleteComment(commentId) {
          session.deleteComment(commentId);
          announce("Draft comment deleted.");
        },
        toggleComment(commentId) {
          session.toggleComment(commentId);
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
          if (flagIds.length === 0) return;
          set((state) => {
            const allSelected = flagIds.every((id) =>
              state.selectedRiskFlags.has(id),
            );
            const next = new Set(state.selectedRiskFlags);
            for (const id of flagIds) {
              if (allSelected) next.delete(id);
              else next.add(id);
            }
            return { selectedRiskFlags: next };
          });
        },
        clearRiskSelection(flagIds) {
          if (flagIds.length === 0) return;
          set((state) => {
            const next = new Set(state.selectedRiskFlags);
            for (const id of flagIds) next.delete(id);
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
        clearToast() {
          set({ toast: "" });
        },
      },
    };
  });
}
