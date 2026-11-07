import { useState } from "react";

import { Callout } from "@web/components/Callout";
import { useCalloutHover } from "@web/components/Callout/useCalloutHover";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import type { MarkConfig } from "../types";
import styles from "./ProviderMark.module.scss";

export interface ProviderMarkProps {
  /** The provider's official mark; absent for a provider with none. */
  config: MarkConfig | undefined;
  providerSlug: string;
}

/** A provider's official mark; a mouse resting on it gets the name the logo stands for. */
export function ProviderMark({ config, providerSlug }: ProviderMarkProps) {
  const [anchor, setAnchor] = useState<HTMLSpanElement | null>(null);
  const hover = useCalloutHover();

  if (config === undefined) {
    // Named fallback: the terminal glyph plus the provider key as
    // visible text, never a hand-drawn brand approximation.
    return (
      <span className={styles["markCell"]}>
        <Icon
          className={styles["mark"]}
          name={IconNames.TERMINAL}
          size={IconSizes.MD}
        />
        <span className={styles["markName"]}>{providerSlug}</span>
      </span>
    );
  }

  return (
    <>
      <span
        className={styles["markCell"]}
        onPointerEnter={hover.arm}
        onPointerLeave={hover.disarm}
        ref={setAnchor}
      >
        <Icon
          className={styles["mark"]}
          name={config.mark}
          size={IconSizes.MD}
        />
        <ScreenReaderOnly>{config.name}</ScreenReaderOnly>
      </span>
      {hover.open && anchor !== null ? (
        <Callout anchor={anchor} compact fit onClose={hover.close}>
          <Callout.Title>{config.name}</Callout.Title>
        </Callout>
      ) : null}
    </>
  );
}
