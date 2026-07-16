// The BRIEF-24 raw span diff toggle (locked decision #7): inside the Changes
// Only pane, a switch that swaps the netted-out comparison summary for the
// GitHub-style raw diff of the SAME span (compare baseline → selected head).
// The diff renders through the existing pipeline — `buildRawSpanDiffChunks`
// (parseUnifiedDiffPatch) feeding `DiffTable` in read-only mode. FE-only and
// ephemeral: the parent keys this component by the span descriptor, so
// switching compare lens or revision remounts it and resets the toggle to off
// (the summary). The whole-PR diff is fetched lazily — only once toggled on.
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";

import type { ChunkComparisonView } from "../../comparison";
import type { ComparisonQuery } from "../../comparisonQuery";
import { buildRawSpanDiffChunks } from "../../rawSpanDiff";
import type { BriefChunk } from "../../types";
import { DiffTable } from "../DiffTable/DiffTable";
import styles from "./RawSpanDiff.module.scss";

export interface RawSpanDiffProps {
  /** Live span-diff descriptor for the active baseline → selected head. */
  query: ComparisonQuery<string>;
  /** The Changes Only summary — shown when the raw diff is toggled off. */
  children: ReactNode;
}

// The raw diff is a comparison lens, not the Brief's own chunks: its rows carry
// no meaningful comment anchors, so `DiffTable` is always read-only here (the
// reason keeps the disabled rows keyboard-discoverable — BRIEF-23 pattern).
const READ_ONLY_REASON =
  "This is the raw diff for the comparison — comment from the brief itself.";
// Shared inert singletons: a read-only table paints no overlay and no comments,
// so these never mutate — hoisted so every file's table shares one identity
// (no per-render allocation; perf review).
const EMPTY_COMPARISON_VIEW: ChunkComparisonView = {
  marks: new Map(),
  runs: [],
  runByRow: new Map(),
};
const NO_OP = (): void => {};

interface RawSpanDiffState {
  showRaw: boolean;
  toggle: () => void;
  isLoading: boolean;
  isError: boolean;
  /** The fetch SUCCEEDED — an empty `chunks` then means a no-change span. */
  isSuccess: boolean;
  chunks: BriefChunk[];
}

/**
 * Facade hook: owns the ephemeral toggle and the lazy span-diff fetch, and
 * reshapes the diff text into read-only chunks. The query stays disabled until
 * the reviewer opens the raw view, so the whole-PR diff is never fetched for a
 * pane nobody expanded.
 */
function useRawSpanDiff(query: ComparisonQuery<string>): RawSpanDiffState {
  const [showRaw, setShowRaw] = useState(false);
  // The toggle GATES the descriptor's own `enabled`, never overrides it: a
  // descriptor disabled to guard an unavailable span must stay unfetched even
  // when the reviewer opens the raw view (codex round 1) — the body then
  // degrades to the not-viewable copy.
  const guarded = query.enabled === false;
  const diff = useQuery({
    ...query,
    enabled: showRaw && !guarded,
  });
  // A guarded descriptor must also veto CACHED data: `enabled: false` only
  // blocks fetching — react-query still serves a previously-cached body for
  // the same key, which would render a span the descriptor says is
  // unavailable (codex round 4). The guard wins over the cache.
  const body = guarded ? undefined : diff.data;
  const chunks = useMemo(
    () => (body === undefined ? [] : buildRawSpanDiffChunks(body)),
    [body],
  );
  return {
    showRaw,
    toggle: () => setShowRaw((current) => !current),
    isLoading: !guarded && diff.isLoading,
    isError: !guarded && diff.isError,
    isSuccess: !guarded && diff.isSuccess,
    chunks,
  };
}

export function RawSpanDiff({ query, children }: RawSpanDiffProps) {
  const raw = useRawSpanDiff(query);
  return (
    <div className={styles["wrap"]}>
      <div className={styles["toolbar"]}>
        {/* Toggle-button contract: the accessible NAME stays stable across
            presses; only aria-pressed flips (codex round 1). */}
        <button
          aria-pressed={raw.showRaw}
          className={styles["toggle"]}
          onClick={raw.toggle}
          type="button"
        >
          Raw diff
        </button>
      </div>
      {raw.showRaw ? <RawSpanDiffBody state={raw} /> : children}
    </div>
  );
}

interface RawSpanDiffBodyProps {
  state: RawSpanDiffState;
}

function RawSpanDiffBody({ state }: RawSpanDiffBodyProps) {
  if (state.isLoading) {
    return (
      <p className={styles["meta"]} role="status">
        Loading the raw diff…
      </p>
    );
  }
  // A SUCCESSFUL fetch with no per-file chunks is a legitimate no-change span
  // (identical content at base and head — e.g. every edit netted out): say so
  // honestly instead of the failure copy (codex round 2). "Not viewable"
  // stays for error AND for a descriptor that disabled itself (never fetched).
  if (state.isSuccess && state.chunks.length === 0) {
    return (
      <p className={styles["meta"]} role="status">
        No raw changes in this span — the compared revisions have identical
        content.
      </p>
    );
  }
  if (state.isError || state.chunks.length === 0) {
    return (
      <p className={styles["meta"]} role="status">
        The raw diff is not viewable right now.
      </p>
    );
  }
  return (
    <div className={styles["files"]}>
      {state.chunks.map((chunk) => (
        <details
          className={styles["file"]}
          key={chunk.id}
          open={state.chunks.length <= 5}
        >
          <summary className={styles["fileName"]}>{chunk.file}</summary>
          <ReadonlyDiffTable chunk={chunk} />
        </details>
      ))}
    </div>
  );
}

interface ReadonlyDiffTableProps {
  chunk: BriefChunk;
}

/** A `DiffTable` with every write affordance stood down (raw diff is read-only). */
function ReadonlyDiffTable({ chunk }: ReadonlyDiffTableProps) {
  return (
    <DiffTable
      activeCommentAnchor={null}
      addressedComments={[]}
      cancelCommentComposer={NO_OP}
      chunk={chunk}
      comments={[]}
      comparisonSkipReason={null}
      comparisonSource={{ kind: "last-review", delta: null }}
      comparisonView={EMPTY_COMPARISON_VIEW}
      composerDisabledReason={READ_ONLY_REASON}
      deleteReviewComment={NO_OP}
      openCommentComposer={NO_OP}
      reviewCommentLabel=""
      saveReviewComment={NO_OP}
      toggleReviewComment={NO_OP}
      updateReviewComment={NO_OP}
    />
  );
}
