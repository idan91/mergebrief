// Inside the Changes Only pane, a switch that swaps the netted-out comparison
// summary for the raw diff of the SAME span. The toggle is ephemeral: the
// parent keys this component by the span descriptor, so switching the comparison
// or revision resets it to off. The span diff is fetched when the toggle
// first opens.
import { useTranslation } from "react-i18next";
import { ToolbarButton } from "@web/components/ToolbarButton";
import { useReviewActions, useReviewFlow } from "@web/features/review/session";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, type SyntheticEvent, useMemo, useState } from "react";

import type { ComparisonQuery } from "../../../../../model/comparison/comparisonQuery";
import { buildRawSpanDiffChunks } from "../../../../../model/utils/rawSpanDiff";
import type { BriefChunk } from "../../../../../model/types";
import { GuestDiff } from "../GuestDiff";
import { GuestDiffVariants } from "../GuestDiff/types";
import type { ChangesReviewWiring } from "../types";
import styles from "./RawSpanDiff.module.scss";

export interface RawSpanDiffProps {
  /** Live span-diff descriptor for the active baseline → selected head. */
  query: ComparisonQuery<string>;
  /** What the guest tables need to take a comment; absent leaves every row inert. */
  review?: ChangesReviewWiring | undefined;
  /** The Changes Only summary, shown when the raw diff is toggled off. */
  children: ReactNode;
}

interface RawSpanDiffState {
  showRaw: boolean;
  toggle: () => void;
  isLoading: boolean;
  isError: boolean;
  /** The fetch SUCCEEDED, an empty `chunks` then means a no-change span. */
  isSuccess: boolean;
  chunks: BriefChunk[];
}

/**
 * Facade hook: owns the ephemeral toggle and the span-diff fetch, and
 * reshapes the diff text into one guest chunk per file. The query stays
 * disabled until the reviewer opens the raw view, so the span diff is never
 * fetched for a pane nobody expanded.
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
  // `enabled: false` only blocks fetching, react-query still serves a cached
  // body for the same key, so the guard has to veto the cache too.
  const body = guarded ? undefined : diff.data;
  const { t } = useTranslation();
  const chunks = useMemo(
    () => (body === undefined ? [] : buildRawSpanDiffChunks(t, body)),
    [body, t],
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

export function RawSpanDiff({ query, review, children }: RawSpanDiffProps) {
  const { t } = useTranslation();
  const raw = useRawSpanDiff(query);
  return (
    <div className={styles["wrap"]}>
      <div className={styles["toolbar"]}>
        {/* Toggle-button contract: the accessible NAME stays stable across
            presses; only aria-pressed flips. */}
        <ToolbarButton
          aria-pressed={raw.showRaw}
          className={styles["toggle"]}
          onClick={raw.toggle}
        >
          {t("brief.diff.rawToggle")}
        </ToolbarButton>
      </div>
      {raw.showRaw ? <RawSpanDiffBody review={review} state={raw} /> : children}
    </div>
  );
}

interface RawSpanDiffBodyProps {
  state: RawSpanDiffState;
  review: ChangesReviewWiring | undefined;
}

function RawSpanDiffBody({ state, review }: RawSpanDiffBodyProps) {
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
        <SpanFile
          chunk={chunk}
          key={chunk.id}
          openByDefault={state.chunks.length <= 5}
          review={review}
        />
      ))}
    </div>
  );
}

interface SpanFileProps {
  chunk: BriefChunk;
  openByDefault: boolean;
  review: ChangesReviewWiring | undefined;
}

/**
 * One file's panel. Collapsing it keeps the table mounted, so a composer
 * it hosts is cancelled here rather than left open out of sight.
 */
function SpanFile({ chunk, openByDefault, review }: SpanFileProps) {
  const { cancelComposer } = useReviewActions();
  const hostsComposer = useReviewFlow(
    (state) => state.composerHost === chunk.id,
  );
  const handleToggle = (event: SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open && hostsComposer) {
      cancelComposer();
    }
  };

  return (
    <details
      className={styles["file"]}
      onToggle={handleToggle}
      open={openByDefault}
    >
      <summary className={styles["fileName"]}>{chunk.file}</summary>
      <GuestDiff
        chunk={chunk}
        review={review}
        variant={GuestDiffVariants.FILE}
      />
    </details>
  );
}
