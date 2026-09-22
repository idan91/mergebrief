import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { AccessibleLink } from "@web/components/AccessibleLink/AccessibleLink";
import { Menu } from "@web/components/Menu/Menu";
import { MenuRow } from "@web/components/Menu/MenuRow/MenuRow";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import { PullRequestSources } from "@web/features/pulls/types";
import type { InboxItem } from "../../../../types";
import CopyIcon from "../../../icons/copy.svg?react";
import DotsIcon from "../../../icons/dots-three.svg?react";
import GitHubIcon from "../../../icons/github-logo.svg?react";
import TrashIcon from "../../../icons/trash.svg?react";
import styles from "./RowActions.module.scss";
import { useRowActionsFacade } from "./useRowActionsFacade";

export interface RowActionsProps {
  item: InboxItem;
  /** Page-level live region: the outcome of a copy or a delete. */
  onAnnounce: (message: string) => void;
  /** The row is gone; the list decides where focus goes. */
  onDeleted: () => void;
}

/**
 * The right-edge actions a hover or the keyboard cursor reveals: Open on
 * GitHub when the repository is known, and a menu with Copy link and, on
 * the viewer's own URL rows, Delete. Regenerate joins them when a row is
 * behind.
 */
export function RowActions({ item, onAnnounce, onDeleted }: RowActionsProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const href = router.buildLocation({
    to: "/repos/$repoId/pulls/$prNumber",
    params: { repoId: item.repoId, prNumber: String(item.prNumber) },
  }).href;
  const facade = useRowActionsFacade(item, href, onAnnounce, onDeleted);
  const githubUrl =
    item.repoSlug === null
      ? null
      : `https://github.com/${item.repoSlug}/pull/${String(item.prNumber)}`;

  return (
    <div className={styles["actions"]}>
      {githubUrl === null ? null : (
        <AccessibleLink
          className={styles["link"]}
          href={githubUrl}
          target="_blank"
        >
          <GitHubIcon aria-hidden="true" />
          <ScreenReaderOnly>
            {t("home.inbox.actions.openOnGithub")}
          </ScreenReaderOnly>
        </AccessibleLink>
      )}
      <Menu
        label={t("home.inbox.actions.more")}
        placement="bottom-end"
        trigger={<DotsIcon aria-hidden="true" />}
        triggerClassName={styles["trigger"]}
      >
        <MenuRow onSelect={facade.copyLink}>
          <span className={styles["rowLabel"]}>
            <CopyIcon aria-hidden="true" />
            {t("home.inbox.actions.copyLink")}
          </span>
        </MenuRow>
        {item.source === PullRequestSources.URL ? (
          <MenuRow
            className={styles["danger"]}
            disabled={facade.deleting}
            onSelect={facade.deleteRow}
          >
            <span className={styles["rowLabel"]}>
              <TrashIcon aria-hidden="true" />
              {t("home.inbox.actions.delete")}
            </span>
          </MenuRow>
        ) : null}
      </Menu>
    </div>
  );
}
