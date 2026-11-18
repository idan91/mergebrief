import type { ComponentPropsWithRef } from "react";
import { useTranslation } from "react-i18next";

import { ScreenReaderOnly } from "../ScreenReaderOnly";

export type AccessibleLinkProps = ComponentPropsWithRef<"a">;

/**
 * Unstyled semantic `<a>`, full attribute passthrough including
 * `className`, zero CSS. `target="_blank"` defaults `rel="noreferrer"` and
 * appends a screen-reader-only new-tab announcement.
 */
export function AccessibleLink(props: AccessibleLinkProps) {
  const { children, rel, target, ...rest } = props;
  const { t } = useTranslation();
  const newTab = target === "_blank";
  return (
    <a {...rest} rel={newTab ? (rel ?? "noreferrer") : rel} target={target}>
      {children}
      {newTab ? (
        <ScreenReaderOnly>{t("a11y.opensInNewTab")}</ScreenReaderOnly>
      ) : null}
    </a>
  );
}
