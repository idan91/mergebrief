import { createStore, type StoreApi } from "zustand/vanilla";

import type { Category, Concern } from "../../brief/types";
import type { BriefViewModel } from "../../brief/viewModel";
import type { ReviewComment } from "../comments";
import type { ReviewOutcome, RiskEvidence } from "../state";
import type { BulkDisposition, Disposition } from "./disposition";

/**
 * @description Playbook progress bucket: one per carrier group, or per support concern.
 */
export type CheckBucket = `carrier:${string}` | `support:${string}:${Concern}`;

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
  checkedItems: Record<CheckBucket, Set<number>>;
  reviewComments: ReviewComment[];
  reviewOutcome: ReviewOutcome;
}

export interface MindMapActions {
  /**
   * @description Toggle chunk membership in the reviewed set.
   * Collapse-on-review is wired in the component; see briefs route handler.
   */
  reviewChunk(chunkId: string): void;
  /**
   * @description Open/dismissed dispositions share one payload across the batch.
   */
  disposeFlag(flagIds: string[], disposition: BulkDisposition): void;
  /**
   * @description Addressed dispositions derive evidence per flag, so they take a resolver.
   */
  addressFlags(
    flagIds: string[],
    evidenceFor: (flagId: string) => RiskEvidence,
  ): void;
  /**
   * @description Sets the dominant category, marks the group reclassified, and resets carrier checks.
   */
  reclassifyGroup(groupId: string, category: Category): void;
  checkPlaybookItem(bucket: CheckBucket, index: number): void;
  saveComment(comment: ReviewComment): void;
  updateComment(id: string, body: string): void;
  deleteComment(id: string): void;
  /**
   * @description Toggles a draft comment's collapsed flag as part of its persisted lifecycle.
   */
  toggleComment(id: string): void;
  setOutcome(outcome: ReviewOutcome): void;
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
    checkedItems: {},
    reviewComments: [],
    reviewOutcome: "comment",
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
      addressFlags(flagIds, evidenceFor) {
        if (flagIds.length === 0) return;
        set((state) => {
          const dispositions = { ...state.dispositions };
          for (const id of flagIds) {
            dispositions[id] = { kind: "addressed", evidence: evidenceFor(id) };
          }
          return { dispositions };
        });
      },
      reclassifyGroup(groupId, category) {
        set((state) => ({
          dominants: { ...state.dominants, [groupId]: category },
          reclassifiedGroups: new Set(state.reclassifiedGroups).add(groupId),
          checkedItems: {
            ...state.checkedItems,
            [`carrier:${groupId}`]: new Set<number>(),
          },
        }));
      },
      checkPlaybookItem(bucket, index) {
        set((state) => ({
          checkedItems: {
            ...state.checkedItems,
            [bucket]: toggle(state.checkedItems[bucket] ?? new Set(), index),
          },
        }));
      },
      saveComment(comment) {
        set((state) => ({
          reviewComments: [...state.reviewComments, comment],
        }));
      },
      updateComment(id, body) {
        set((state) => ({
          reviewComments: state.reviewComments.map((comment) =>
            comment.id === id
              ? { ...comment, body, collapsed: false }
              : comment,
          ),
        }));
      },
      deleteComment(id) {
        set((state) => ({
          reviewComments: state.reviewComments.filter(
            (comment) => comment.id !== id,
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
      setOutcome(outcome) {
        set({ reviewOutcome: outcome });
      },
    },
  }));
}
