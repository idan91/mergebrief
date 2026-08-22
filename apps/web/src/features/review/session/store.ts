import type { TranslationKey } from "i18n";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { Category } from "../../brief/types";
import type { BriefViewModel } from "@web/features/brief/utils";
import type { CommentAnchor, ReviewComment } from "../utils/comments";
import type { ReviewOutcome, RiskEvidence } from "../utils/state";
import type { BulkDisposition, Disposition } from "./disposition";
import type { SessionWriteGateway } from "./writeGateway";
import type { SessionWriteResult } from "./writes";

/**
 * @description Session/domain state of the Review Session — the shared, persisted half.
 */
export interface ReviewSessionState {
  /**
   * @description Keyed by brief-local `flag.id`.
   * TODO: move to region@SHA.
   */
  dispositions: Record<string, Disposition>;
  dominants: Record<string, Category>;
  reclassifiedGroups: Set<string>;
  reviewedChunks: Set<string>;
  reviewComments: ReviewComment[];
  reviewOutcome: ReviewOutcome;
  /**
   * @description Review ids returned by this session's successful submits —
   * the own-comment join keys against fetched conversation threads.
   */
  submittedReviewIds: number[];
}

export interface ReviewSessionActions {
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
  /**
   * Stages a draft comment. Awaits the write and answers whether it LANDED —
   * the composer closes on success rather than on click, so a failure leaves
   * it open holding its text and the same action still available.
   */
  saveComment: (comment: Omit<ReviewComment, "id">) => Promise<boolean>;
  updateComment: (id: string, body: string) => void;
  /**
   * Re-places a carried draft the reviewer picked a new home for. The human
   * placing it IS the carry-over verdict, so nothing is inferred here.
   */
  reanchorComment: (id: string, anchor: CommentAnchor) => boolean;
  /**
   * Deletes a carried draft this Brief renders nowhere. It is not in
   * `reviewComments`, so the ordinary delete has nothing to act on.
   */
  deleteMissingDraft: (id: string) => void;
  deleteComment: (id: string) => void;
  /**
   * @description Toggles a draft comment's collapsed flag as part of its persisted lifecycle.
   */
  toggleComment: (id: string) => void;
  /**
   * @description After a successful submit: exactly the POSTED comments flip
   * to `submitted` (ids captured at click time — a draft added or edited
   * while the request was in flight stays a draft), so a later re-submit
   * ships only comments GitHub never saw.
   */
  markCommentsSubmitted: (ids: readonly string[]) => void;
  /**
   * @description Record a successful submit's created review id — the
   * server-backed join key for own-comment reconciliation.
   */
  recordSubmittedReview: (reviewId: number) => void;
  setOutcome: (outcome: ReviewOutcome) => void;
  /** Drops the pending failure copy once the screen has announced it. */
  clearWriteError: () => void;
}

export interface ReviewSessionStoreValue extends ReviewSessionState {
  /**
   * A write came back `pr-changed-since-read`. TERMINAL for the screen, not
   * a per-action failure: the reviewer has work on a newer Brief, so every
   * retry fails identically. The screen goes read-only behind the revision
   * banner; typed text stays visible to copy, and nothing drafts locally.
   */
  frozen: boolean;
  /** The last failed write's copy, for the screen to announce; null = none. */
  writeError: TranslationKey | null;
  /**
   * Carried drafts deleted from the attention list whose file this Brief
   * renders nowhere: the store never held them, so their absence cannot say
   * whether the reviewer acted. Not session data — this tab's own action.
   */
  deletedMissingDrafts: Set<string>;
  actions: ReviewSessionActions;
}

export type ReviewSessionStore = StoreApi<ReviewSessionStoreValue>;

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
  const crossing =
    anchor.startSide !== undefined && anchor.startSide !== anchor.side
      ? `${anchor.startSide}-`
      : "";
  const base = `${anchor.chunkId}-${crossing}${anchor.side}-${anchor.startLine}-${anchor.endLine}`;
  const taken = new Set(existing.map((comment) => comment.id));
  let n = 1;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Initial session state derived from the brief view model (snapshot overrides). */
export function deriveInitialState(model: BriefViewModel): ReviewSessionState {
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
  };
}

/**
 * Restores one set's membership to a captured value — the revert half of an
 * optimistic toggle.
 */
function withMembership<T>(
  set: ReadonlySet<T>,
  value: T,
  member: boolean,
): Set<T> {
  const next = new Set(set);
  if (member) next.add(value);
  else next.delete(value);
  return next;
}

/**
 * The per-brief session store. Every action fires EXACTLY ONE operation —
 * no batching, no debounce, no retry machinery — and applies optimistically
 * so the screen answers the click immediately. A failed write REVERTS: the
 * UI returns to the state where that same action is still available, which
 * is the whole of the recovery story (a retry is the action again).
 *
 * `getGateway` is a getter, not a value: the model behind the wire mapping is
 * re-derived on a revision switch while this store survives it. Null gateway
 * = no writes wired (the local file-backed path), where actions stay local.
 */
export function createReviewSessionStore(
  initial: ReviewSessionState,
  getGateway: () => SessionWriteGateway | null = () => null,
): ReviewSessionStore {
  return createStore<ReviewSessionStoreValue>((set, get) => {
    /**
     * Fire one operation. A failure reverts and records its copy; a frozen
     * session additionally closes the screen. `null` = no gateway (the local
     * path), where the optimistic state IS the state.
     */
    async function attempt<T>(
      operation: (
        gateway: SessionWriteGateway,
      ) => Promise<SessionWriteResult<T>>,
      revert: () => void,
    ): Promise<SessionWriteResult<T> | null> {
      const gateway = getGateway();
      if (gateway === null) return null;
      const result = await operation(gateway);
      if (result.ok) return result;
      revert();
      set(
        result.failure.frozen
          ? { frozen: true, writeError: result.failure.copy }
          : { writeError: result.failure.copy },
      );
      return result;
    }

    /** True when the write landed, or there was none to make. */
    async function landed(
      operation: (gateway: SessionWriteGateway) => Promise<SessionWriteResult>,
      revert: () => void,
    ): Promise<boolean> {
      const result = await attempt(operation, revert);
      return result === null || result.ok;
    }

    return {
      ...initial,
      frozen: false,
      writeError: null,
      deletedMissingDrafts: new Set(),
      actions: {
        reviewChunk(chunkId) {
          const wasRead = get().reviewedChunks.has(chunkId);
          set((state) => ({
            reviewedChunks: toggle(state.reviewedChunks, chunkId),
          }));
          void landed(
            (gateway) => gateway.setRead(chunkId, !wasRead),
            () =>
              set((state) =>
                // Revert only what this action still owns: a newer write on
                // the same subject has already replaced it, and restoring the
                // captured value would put the screen behind the server.
                state.reviewedChunks.has(chunkId) === wasRead
                  ? {}
                  : {
                      reviewedChunks: withMembership(
                        state.reviewedChunks,
                        chunkId,
                        wasRead,
                      ),
                    },
              ),
          );
        },
        disposeFlag(flagIds, disposition) {
          if (flagIds.length === 0) return;
          const before = capture(get().dispositions, flagIds);
          const applied: Record<string, Disposition> = {};
          for (const id of flagIds) {
            applied[id] =
              disposition.kind === "open"
                ? { kind: "open" }
                : { kind: "dismissed", reason: disposition.reason };
          }
          set((state) => ({
            dispositions: { ...state.dispositions, ...applied },
          }));
          void landed(
            (gateway) => gateway.dispose(flagIds, disposition),
            () =>
              set((state) => ({
                dispositions: restore(state.dispositions, before, applied),
              })),
          );
        },
        addressFlags(evidenceByFlagId) {
          if (evidenceByFlagId.size === 0) return;
          const ids = [...evidenceByFlagId.keys()];
          const before = capture(get().dispositions, ids);
          const applied: Record<string, Disposition> = {};
          for (const [id, evidence] of evidenceByFlagId) {
            applied[id] = { kind: "addressed", evidence };
          }
          set((state) => ({
            dispositions: { ...state.dispositions, ...applied },
          }));
          void landed(
            (gateway) => gateway.address(evidenceByFlagId),
            () =>
              set((state) => ({
                dispositions: restore(state.dispositions, before, applied),
              })),
          );
        },
        reclassifyGroup(groupId, category) {
          const state = get();
          const previous = state.dominants[groupId];
          const wasReclassified = state.reclassifiedGroups.has(groupId);
          set((current) => ({
            dominants: { ...current.dominants, [groupId]: category },
            reclassifiedGroups: new Set(current.reclassifiedGroups).add(
              groupId,
            ),
          }));
          void landed(
            (gateway) => gateway.reclassify(groupId, category),
            () =>
              set((current) => ({
                ...(previous === undefined
                  ? {}
                  : {
                      dominants: { ...current.dominants, [groupId]: previous },
                    }),
                reclassifiedGroups: withMembership(
                  current.reclassifiedGroups,
                  groupId,
                  wasReclassified,
                ),
              })),
          );
        },
        async saveComment(comment) {
          const gateway = getGateway();
          if (gateway === null) {
            // No writes wired (the local path): the store IS the record.
            set((state) => ({
              reviewComments: [
                ...state.reviewComments,
                {
                  ...comment,
                  id: getUniqueCommentId(comment.anchor, state.reviewComments),
                },
              ],
            }));
            return true;
          }
          // The draft is added when the write LANDS, not on click: a card
          // rendered under a composer that is still saying "Saving…" is the
          // half-applied state this design refuses. The composer's own
          // pending affordance is what stands in meanwhile.
          const created = await gateway.createComment(comment);
          if (!created.ok) {
            set(
              created.failure.frozen
                ? { frozen: true, writeError: created.failure.copy }
                : { writeError: created.failure.copy },
            );
            return false;
          }
          set((state) => ({
            reviewComments: [
              ...state.reviewComments,
              {
                ...comment,
                // The server's row id is what post-now and every later edit
                // address the draft by; a contract-violating empty id falls
                // back to a local one until the next read replaces it.
                id:
                  created.value === ""
                    ? getUniqueCommentId(comment.anchor, state.reviewComments)
                    : created.value,
              },
            ],
          }));
          return true;
        },
        updateComment(id, body) {
          const before = get().reviewComments.find(
            (comment) => comment.id === id && comment.status === "draft",
          );
          if (before === undefined) return;
          set((state) => ({
            reviewComments: state.reviewComments.map((comment) =>
              // Submitted comments are immutable: GitHub holds the posted text,
              // and a local edit would never ship (re-submits are drafts-only).
              comment.id === id && comment.status === "draft"
                ? { ...comment, body, collapsed: false }
                : comment,
            ),
          }));
          void landed(
            (gateway) => gateway.updateComment(id, body),
            () =>
              set((state) => ({
                reviewComments: state.reviewComments.map((comment) =>
                  // A newer edit that already landed owns the body now.
                  comment.id === id && comment.body === body ? before : comment,
                ),
              })),
          );
        },
        reanchorComment(id, anchor) {
          const before = get().reviewComments.find(
            (comment) => comment.id === id && comment.status === "draft",
          );
          if (before === undefined) return false;
          set((state) => ({
            reviewComments: state.reviewComments.map((comment) =>
              comment.id === id && comment.status === "draft"
                ? { ...comment, anchor, collapsed: false }
                : comment,
            ),
          }));
          void landed(
            (gateway) => gateway.reanchorComment(id, anchor),
            () =>
              set((state) => ({
                reviewComments: state.reviewComments.map((comment) =>
                  comment.id === id ? before : comment,
                ),
              })),
          );
          return true;
        },
        deleteMissingDraft(id) {
          if (get().deletedMissingDrafts.has(id)) return;
          set((state) => ({
            deletedMissingDrafts: new Set([...state.deletedMissingDrafts, id]),
          }));
          void landed(
            (gateway) => gateway.deleteComment(id),
            () =>
              set((state) => {
                const next = new Set(state.deletedMissingDrafts);
                next.delete(id);
                return { deletedMissingDrafts: next };
              }),
          );
        },
        deleteComment(id) {
          const comments = get().reviewComments;
          const index = comments.findIndex(
            (comment) => comment.id === id && comment.status === "draft",
          );
          const removed = comments[index];
          if (removed === undefined) return;
          set((state) => ({
            reviewComments: state.reviewComments.filter(
              (comment) => comment.id !== id || comment.status === "submitted",
            ),
          }));
          void landed(
            (gateway) => gateway.deleteComment(id),
            () =>
              set((state) => {
                const restored = [...state.reviewComments];
                restored.splice(Math.min(index, restored.length), 0, removed);
                return { reviewComments: restored };
              }),
          );
        },
        toggleComment(id) {
          // Collapse is a rendering preference with no operation behind it.
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
          // The submit route flipped the rows already; this mirrors it.
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
        setOutcome(outcome) {
          const before = get().reviewOutcome;
          set({ reviewOutcome: outcome });
          void landed(
            (gateway) => gateway.setOutcome(outcome),
            () =>
              set((state) =>
                state.reviewOutcome === outcome
                  ? { reviewOutcome: before }
                  : {},
              ),
          );
        },
        clearWriteError() {
          set({ writeError: null });
        },
      },
    };
  });
}

/** The dispositions the ids currently hold — an optimistic write's undo. */
function capture(
  dispositions: Record<string, Disposition>,
  ids: readonly string[],
): [string, Disposition | undefined][] {
  return ids.map((id) => [id, dispositions[id]]);
}

/**
 * Put the captured dispositions back — but only where the value this action
 * WROTE is still the one on screen. A newer decision on the same flag owns it
 * now, and restoring over it would leave the screen behind the server.
 */
function restore(
  dispositions: Record<string, Disposition>,
  before: [string, Disposition | undefined][],
  applied: Record<string, Disposition>,
): Record<string, Disposition> {
  const next = { ...dispositions };
  for (const [id, disposition] of before) {
    if (next[id] !== applied[id]) continue;
    if (disposition === undefined) delete next[id];
    else next[id] = disposition;
  }
  return next;
}
