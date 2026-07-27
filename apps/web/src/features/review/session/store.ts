import { createStore, type StoreApi } from "zustand/vanilla";

import type { Category } from "../../brief/types";
import type { BriefViewModel } from "@web/features/brief/utils";
import type { CommentAnchor, ReviewComment } from "../utils/comments";
import type { ReviewOutcome, RiskEvidence } from "../utils/state";
import type { BulkDisposition, Disposition } from "./disposition";

/**
 * @description Session/domain state of the Mind-Map Space — the shared, persisted half.
 */
export interface MindMapState {
  /**
   * @description Keyed by brief-local `flag.id`.
   * TODO(adr-0022): move to region@SHA.
   */
  dispositions: Record<string, Disposition>;
  dominants: Record<string, Category>;
  reclassifiedGroups: Set<string>;
  reviewedChunks: Set<string>;
  reviewComments: ReviewComment[];
  reviewOutcome: ReviewOutcome;
  /**
   * @description Review ids returned by this session's successful submits —
   * the own-comment join keys against fetched conversation threads (BRIEF-25).
   */
  submittedReviewIds: number[];
  /**
   * @description Conversation reply drafts, keyed by thread root comment id
   * (BRIEF-25) — a half-written reply survives navigation.
   */
  replyDrafts: Record<string, string>;
}

export interface MindMapActions {
  /**
   * @description Toggle chunk membership in the reviewed set.
   * Collapse-on-review is wired in the component; see briefs route handler.
   */
  reviewChunk: (chunkId: string) => void;
  /**
   * @description Open/dismissed dispositions share one payload across the batch.
   */
  disposeFlag: (flagIds: string[], disposition: BulkDisposition) => void;
  /**
   * @description Addressed dispositions are resolved before mutation, keyed by
   * brief-local flag id.
   */
  addressFlags: (evidenceByFlagId: ReadonlyMap<string, RiskEvidence>) => void;
  /**
   * @description Sets the dominant category and marks the group reclassified.
   */
  reclassifyGroup: (groupId: string, category: Category) => void;
  saveComment: (comment: Omit<ReviewComment, "id">) => void;
  updateComment: (id: string, body: string) => void;
  deleteComment: (id: string) => void;
  /**
   * @description Toggles a draft comment's collapsed flag as part of its persisted lifecycle.
   */
  toggleComment: (id: string) => void;
  /**
   * @description After a successful submit: exactly the POSTED comments flip
   * to `submitted` (ids captured at click time — a draft added or edited
   * while the request was in flight stays a draft), so a later re-submit
   * ships only comments GitHub never saw (BRIEF-23).
   */
  markCommentsSubmitted: (ids: readonly string[]) => void;
  /**
   * @description Record a successful submit's created review id — the
   * server-backed join key for own-comment reconciliation (BRIEF-25).
   */
  recordSubmittedReview: (reviewId: number) => void;
  /**
   * @description Persist a conversation reply draft per thread; an empty
   * body clears the entry (posted or discarded).
   */
  setReplyDraft: (threadId: number, body: string) => void;
  setOutcome: (outcome: ReviewOutcome) => void;
  /**
   * @description Resets the whole session to a fresh state (the "Clear local
   * drafts" action), so the live store matches the now-empty storage.
   */
  reset: (state: MindMapState) => void;
}

export interface MindMapStoreValue extends MindMapState {
  actions: MindMapActions;
}

export type MindMapStore = StoreApi<MindMapStoreValue>;

function toggle<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * Comment id unique against the current list — probes for a free suffix rather
 * than deriving one from `length` (which collides after a delete) and needs no
 * secure context the way `crypto.randomUUID()` would.
 */
function getUniqueCommentId(
  anchor: CommentAnchor,
  existing: ReviewComment[],
): string {
  const base = `${anchor.chunkId}-${anchor.side}-${anchor.startLine}-${anchor.endLine}`;
  const taken = new Set(existing.map((comment) => comment.id));
  let n = 1;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Initial session state derived from the brief view model (snapshot overrides). */
export function deriveInitialState(model: BriefViewModel): MindMapState {
  const dispositions: Record<string, Disposition> = {};
  for (const flag of model.flags) dispositions[flag.id] = { kind: "open" };
  const dominants: Record<string, Category> = {};
  for (const group of model.groups) {
    dominants[group.id] = group.group.dominantCategory;
  }
  return {
    dispositions,
    dominants,
    reclassifiedGroups: new Set(),
    reviewedChunks: new Set(),
    reviewComments: [],
    reviewOutcome: "comment",
    submittedReviewIds: [],
    replyDrafts: {},
  };
}

export function createMindMapStore(initial: MindMapState): MindMapStore {
  return createStore<MindMapStoreValue>((set) => ({
    ...initial,
    actions: {
      reviewChunk(chunkId) {
        set((state) => ({
          reviewedChunks: toggle(state.reviewedChunks, chunkId),
        }));
      },
      disposeFlag(flagIds, disposition) {
        if (flagIds.length === 0) return;
        set((state) => {
          const dispositions = { ...state.dispositions };
          for (const id of flagIds) {
            dispositions[id] =
              disposition.kind === "open"
                ? { kind: "open" }
                : { kind: "dismissed", reason: disposition.reason };
          }
          return { dispositions };
        });
      },
      addressFlags(evidenceByFlagId) {
        if (evidenceByFlagId.size === 0) return;
        set((state) => {
          const dispositions = { ...state.dispositions };
          for (const [id, evidence] of evidenceByFlagId) {
            dispositions[id] = { kind: "addressed", evidence };
          }
          return { dispositions };
        });
      },
      reclassifyGroup(groupId, category) {
        set((state) => ({
          dominants: { ...state.dominants, [groupId]: category },
          reclassifiedGroups: new Set(state.reclassifiedGroups).add(groupId),
        }));
      },
      saveComment(comment) {
        set((state) => ({
          reviewComments: [
            ...state.reviewComments,
            {
              ...comment,
              id: getUniqueCommentId(comment.anchor, state.reviewComments),
            },
          ],
        }));
      },
      updateComment(id, body) {
        set((state) => ({
          reviewComments: state.reviewComments.map((comment) =>
            // Submitted comments are immutable: GitHub holds the posted text,
            // and a local edit would never ship (re-submits are drafts-only).
            comment.id === id && comment.status === "draft"
              ? { ...comment, body, collapsed: false }
              : comment,
          ),
        }));
      },
      deleteComment(id) {
        set((state) => ({
          reviewComments: state.reviewComments.filter(
            (comment) => comment.id !== id || comment.status === "submitted",
          ),
        }));
      },
      toggleComment(id) {
        set((state) => ({
          reviewComments: state.reviewComments.map((comment) =>
            comment.id === id
              ? { ...comment, collapsed: !comment.collapsed }
              : comment,
          ),
        }));
      },
      markCommentsSubmitted(ids) {
        if (ids.length === 0) return;
        const flipped = new Set(ids);
        set((state) => ({
          reviewComments: state.reviewComments.map((comment) =>
            flipped.has(comment.id)
              ? { ...comment, status: "submitted" }
              : comment,
          ),
        }));
      },
      recordSubmittedReview(reviewId) {
        set((state) =>
          state.submittedReviewIds.includes(reviewId)
            ? {}
            : { submittedReviewIds: [...state.submittedReviewIds, reviewId] },
        );
      },
      setReplyDraft(threadId, body) {
        set((state) => {
          const next = { ...state.replyDrafts };
          if (body === "") delete next[String(threadId)];
          else next[String(threadId)] = body;
          return { replyDrafts: next };
        });
      },
      setOutcome(outcome) {
        set({ reviewOutcome: outcome });
      },
      reset(next) {
        set(next);
      },
    },
  }));
}
