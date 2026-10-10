import { Trans, useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";

import { Button } from "@web/components/Button";
import { Kbd, KbdSizes } from "@web/components/Kbd";
import { REANCHOR_HINT_ID } from "../consts";
import styles from "./ReanchorBanner.module.scss";

export interface ReanchorBannerProps {
  /** Where the armed draft sits now, as the attention list labels it. */
  location: string;
  cancel: () => void;
}

/**
 * The re-anchor mode strip, a sibling of <main> like the focus banner. Not
 * a live region: the flow store announces arm and cancel through the hidden
 * region, so the strip is never read twice. Its measured height publishes
 * as --reanchor-banner-h, which the toolbar and sticky chunk headers stack
 * below.
 */
export function ReanchorBanner({ location, cancel }: ReanchorBannerProps) {
  const { t } = useTranslation();
  const bannerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = bannerRef.current;
    if (el === null) {
      return;
    }
    const setHeight = (value: string) =>
      document.documentElement.style.setProperty("--reanchor-banner-h", value);
    const apply = () => setHeight(`${el.offsetHeight}px`);

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      setHeight("0px");
    };
  }, []);

  return (
    <div
      aria-label={t("brief.reanchorBanner.lead")}
      className={styles["reanchorBannerWrap"]}
      data-testid="reanchor-banner"
      ref={bannerRef}
      role="region"
    >
      <div className={styles["reanchorBanner"]}>
        <span id={REANCHOR_HINT_ID}>
          <Trans
            components={[
              <b key="lead">{t("brief.reanchorBanner.lead")}</b>,
              <code className={styles["location"]} key="location">
                {location}
              </code>,
              <Kbd key="esc" size={KbdSizes.SM}>
                {t("brief.reanchorBanner.escKey")}
              </Kbd>,
            ]}
            i18nKey="brief.reanchorBanner.hint"
          />
        </span>
        <Button onClick={cancel}>{t("brief.reanchorBanner.cancel")}</Button>
      </div>
    </div>
  );
}
