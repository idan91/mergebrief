// The new-version notice: an in-flow band directly under the Header that
// scrolls away with the page and never joins the sticky stack.
import { useQuery } from "@tanstack/react-query";
import { Trans, useTranslation } from "react-i18next";

import { AccessibleLink } from "@web/components/AccessibleLink";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import { useDismissVersion } from "../../mutations";
import { buildVersionQueryOptions } from "../../queries";
import type { NoticeSurface } from "../../types";
import { deriveReleaseNotice } from "../../utils";
import styles from "./VersionNotice.module.scss";
import { focusMainContent } from "./utils";

export interface VersionNoticeProps {
  /** Which Header the band sits under; it sets the gutter the text aligns to. */
  surface: NoticeSurface;
}

export function VersionNotice({ surface }: VersionNoticeProps) {
  const { t } = useTranslation();
  const { data } = useQuery(buildVersionQueryOptions());
  const dismiss = useDismissVersion();
  const notice = deriveReleaseNotice(data);

  if (notice === undefined) {
    return null;
  }

  const dismissRelease = () => {
    dismiss.mutate(notice.latest, { onSuccess: focusMainContent });
  };

  const leadKey = notice.security
    ? "shell.versionNotice.security"
    : "shell.versionNotice.available";
  const version = <span className={styles["version"]} key="version" />;

  return (
    <div
      aria-label={t("shell.versionNotice.regionLabel")}
      className={styles["notice"]}
      data-surface={surface}
      data-testid="version-notice"
      data-tone={notice.security ? "warning" : undefined}
      role="status"
    >
      <div className={styles["inner"]}>
        {notice.security ? (
          <Icon
            className={styles["mark"]}
            name={IconNames.WARNING}
            size={IconSizes.LG}
          />
        ) : null}
        <p className={styles["text"]}>
          <strong className={styles["lead"]}>
            <Trans
              components={[version]}
              i18nKey={leadKey}
              values={{ latest: notice.latest }}
            />
          </strong>{" "}
          <span>
            {t("shell.versionNotice.running", { current: notice.current })}
            {notice.breaking ? <> {t("shell.versionNotice.breaking")}</> : null}
          </span>
        </p>
        <div className={styles["actions"]}>
          {notice.releaseNotesUrl === undefined ? null : (
            <AccessibleLink
              className={styles["link"]}
              href={notice.releaseNotesUrl}
              target="_blank"
            >
              {t("shell.versionNotice.releaseNotes")}
              <Icon
                className={styles["linkIcon"]}
                name={IconNames.ARROW_UP_RIGHT}
                size={IconSizes.SM}
              />
            </AccessibleLink>
          )}
          {notice.security ? null : (
            <IconButton
              disabled={dismiss.isPending}
              label={t("shell.versionNotice.dismiss")}
              onClick={dismissRelease}
              size="sm"
            >
              <Icon name={IconNames.X} size={IconSizes.MD} />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}
