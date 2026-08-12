import { Trans, useTranslation } from "react-i18next";
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
 * The banner must render as a sibling of <main>, not inside it, to be a true
 * full-bleed strip; sticky chunk headers stack below it via the measured
 * --focus-banner-h. `data-focus-banner` sits on the outer strip because
 * focusScrollOffset() must measure it whole, padding included.
 */
export function FocusBanner({
  activeChunkId,
  groups,
  jumpToChunk,
  toggleFocusMode,
  bannerRef,
}: FocusBannerProps) {
  const { t } = useTranslation();
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
          <Trans
            components={[
              <b key="lead">{t("brief.focusBanner.lead")}</b>,
              <kbd key="j">J</kbd>,
              <kbd key="k">K</kbd>,
              <kbd key="v">V</kbd>,
              <kbd key="esc">{t("brief.focusBanner.escKey")}</kbd>,
            ]}
            i18nKey="brief.focusBanner.hint"
          />
        </span>
        <ReadThroughProgress
          activeChunkId={activeChunkId}
          groups={groups}
          jumpToChunk={jumpToChunk}
        />
        <button className="btn" type="button" onClick={toggleFocusMode}>
          {t("brief.focusBanner.exit")}
        </button>
      </div>
    </div>
  );
}
