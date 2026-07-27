import type { Ref } from "react";

import type { BriefViewModel } from "../../../utils/viewModel";
import { ReadThroughProgress } from "../ReadThroughProgress/ReadThroughProgress";
import styles from "./FocusBanner.module.scss";

export interface FocusBannerProps {
  activeChunkId: string | null;
  groups: BriefViewModel["groups"];
  jumpToChunk: (chunkId: string) => void;
  toggleFocusMode: () => void;
  /** The session measures the strip's height into --focus-banner-h. */
  bannerRef: Ref<HTMLDivElement>;
}

/**
 * Focus mode (Z) strips the page chrome and centers a single chunk in a
 * narrow reading column — the visible payoff of "focus". The banner is a
 * sibling of <main> (not inside it) so it is a true full-bleed strip like
 * the top bar; sticky chunk headers stack below it via the measured
 * --focus-banner-h. data-focus-banner sits on the strip: focusScrollOffset()
 * must measure it whole, padding included.
 */
export function FocusBanner({
  activeChunkId,
  groups,
  jumpToChunk,
  toggleFocusMode,
  bannerRef,
}: FocusBannerProps) {
  return (
    <div
      className={styles["focusBannerWrap"]}
      data-focus-banner=""
      data-testid="focus-banner"
      ref={bannerRef}
      role="status"
    >
      <div className={styles["focusBanner"]}>
        <span>
          <b>Focus mode</b> — one chunk at a time. <kbd>J</kbd>
          <kbd>K</kbd> to move, <kbd>Esc</kbd> to exit.
        </span>
        <ReadThroughProgress
          activeChunkId={activeChunkId}
          groups={groups}
          jumpToChunk={jumpToChunk}
        />
        <button className="btn" type="button" onClick={toggleFocusMode}>
          Exit focus
        </button>
      </div>
    </div>
  );
}
