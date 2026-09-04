import { Trans, useTranslation } from "react-i18next";
import type { Ref } from "react";

import { Button } from "@web/components/Button/Button";
import { Kbd, KbdSizes } from "../Kbd/Kbd";
import type { BriefViewModel } from "../../../utils/viewModel";
import { ReadThroughProgress } from "../ReadThroughProgress/ReadThroughProgress";
import styles from "./FocusBanner.module.scss";

export interface FocusBannerProps {
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
              <Kbd key="j" size={KbdSizes.SM}>
                J
              </Kbd>,
              <Kbd key="k" size={KbdSizes.SM}>
                K
              </Kbd>,
              <Kbd key="v" size={KbdSizes.SM}>
                V
              </Kbd>,
              <Kbd key="esc" size={KbdSizes.SM}>
                {t("brief.focusBanner.escKey")}
              </Kbd>,
            ]}
            i18nKey="brief.focusBanner.hint"
          />
        </span>
        <ReadThroughProgress groups={groups} jumpToChunk={jumpToChunk} />
        <Button onClick={toggleFocusMode}>{t("brief.focusBanner.exit")}</Button>
      </div>
    </div>
  );
}
