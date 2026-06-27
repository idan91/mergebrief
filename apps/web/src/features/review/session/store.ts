import { createStore, type StoreApi } from "zustand/vanilla";

import type { Category, Concern } from "../../brief/types";
import type { BriefViewModel } from "../../brief/viewModel";
import type { ReviewComment } from "../comments";
import type { ReviewOutcome, RiskEvidence } from "../state";
import type { BulkDisposition, Disposition } from "./disposition";

/** Playbook progress bucket: one per carrier group, or per support concern. */
export type CheckBucket = `carrier:${string}` | `support:${string}:${Concern}`;

/** Session/domain state of the Mind-Map Space — the shared, persisted half. */
export interface MindMapState {
  /** key = brief-local flag.id — TODO(adr-0022): → region@SHA */
  dispositions: Record<string, Disposition>;
  dominants: Record<string, Category>;
  reclassifiedGroups: Set<string>;
  reviewedChunks: Set<string>;
  checkedItems: Record<CheckBucket, Set<number>>;
  reviewComments: ReviewComment[];
  reviewOutcome: ReviewOutcome;
}

export interface MindMapActions {
  /** Toggle chunk membership in the reviewed set (collapse-on-review is wired
   *  in the component — see briefs route handler). */
  reviewChunk(chunkId: string): void;
  /** open/dismissed share one payload across the batch — genuinely bulk. */
  disposeFlag(flagIds: string[], disposition: BulkDisposition): void;
  /** addressed derives evidence PER flag, so it takes a resolver, not a value. */
  addressFlags(
    flagIds: string[],
    evidenceFor: (flagId: string) => RiskEvidence,
  ): void;
  /** Sets the dominant, marks the group reclassified, resets its carrier checks. */
  reclassifyGroup(groupId: string, category: Category): void;
  checkPlaybookItem(bucket: CheckBucket, index: number): void;
  saveComment(comment: ReviewComment): void;
  updateComment(id: string, body: string): void;
  deleteComment(id: string): void;
  /** Toggle a draft comment's collapsed flag (part of its persisted lifecycle). */
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
