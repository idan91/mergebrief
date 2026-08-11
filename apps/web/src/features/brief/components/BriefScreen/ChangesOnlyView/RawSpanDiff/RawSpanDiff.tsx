// Inside the Changes Only pane, a switch that swaps the netted-out comparison
// summary for the raw diff of the SAME span. The toggle is ephemeral: the
// parent keys this component by the span descriptor, so switching compare lens
// or revision resets it to off. The whole-PR diff is fetched lazily.
import { useTranslation } from "react-i18next";
import type { TranslationKey } from "i18n";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";

import type { ChunkComparisonView } from "../../../../comparison/comparison";
import type { ComparisonQuery } from "../../../../comparison/comparisonQuery";
import { buildRawSpanDiffChunks } from "../../../../utils/rawSpanDiff";
import type { BriefChunk } from "../../../../types";
import { DiffTable } from "../../DiffTable/DiffTable";
import styles from "./RawSpanDiff.module.scss";

export interface RawSpanDiffProps {
  /** Live span-diff descriptor for the active baseline → selected head. */
  query: ComparisonQuery<string>;
  /** The Changes Only summary — shown when the raw diff is toggled off. */
  children: ReactNode;
}

// The raw diff's rows carry no meaningful comment anchors, so `DiffTable` is
// always read-only here; the reason keeps disabled rows keyboard-discoverable.
const READ_ONLY_REASON_KEY: TranslationKey = "brief.diff.rawReadOnlyReason";
// A read-only table paints no overlay, so this never mutates — hoisted so
// every file's table shares one identity.
const EMPTY_COMPARISON_VIEW: ChunkComparisonView = {
  marks: new Map(),
  runs: [],
  runByRow: new Map(),
};
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
  // descriptor guarding an unavailable span stays unfetched even when the
  // reviewer opens the raw view.
  const guarded = query.enabled === false;
  const diff = useQuery({
    ...query,
    enabled: showRaw && !guarded,
  });
  // `enabled: false` only blocks fetching — react-query still serves a cached
  // body for the same key, so the guard has to veto the cache too.
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
  const { t } = useTranslation();
  const raw = useRawSpanDiff(query);
  return (
    <div className={styles["wrap"]}>
      <div className={styles["toolbar"]}>
        {/* Toggle-button contract: the accessible NAME stays stable across
            presses; only aria-pressed flips. */}
        <button
          aria-pressed={raw.showRaw}
          className={styles["toggle"]}
          onClick={raw.toggle}
          type="button"
        >
          {t("brief.diff.rawToggle")}
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
  const { t } = useTranslation();
  if (state.isLoading) {
    return (
      <p className={styles["meta"]} role="status">
        {t("brief.diff.rawLoading")}
      </p>
    );
  }
  // A SUCCESSFUL fetch with no per-file chunks is a legitimate no-change span,
  // not a failure; "not viewable" stays for errors and guarded descriptors.
  if (state.isSuccess && state.chunks.length === 0) {
    return (
      <p className={styles["meta"]} role="status">
        {t("brief.diff.rawIdentical")}
      </p>
    );
  }
  if (state.isError || state.chunks.length === 0) {
    return (
      <p className={styles["meta"]} role="status">
        {t("brief.diff.rawUnavailable")}
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
  const { t } = useTranslation();
  return (
    <DiffTable
      addressedComments={[]}
      chunk={chunk}
      comparisonSkipReason={null}
      comparisonSource={{ kind: "last-review", delta: null }}
      comparisonView={EMPTY_COMPARISON_VIEW}
      readOnlyReason={t(READ_ONLY_REASON_KEY)}
      reviewCommentLabel=""
    />
  );
}
