import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { InboxArchivedFilters, type InboxArchivedFilter } from "types/inbox";

import { AccessibleLink } from "@web/components/AccessibleLink/AccessibleLink";
import { Menu } from "@web/components/Menu/Menu";
import { MenuRow } from "@web/components/Menu/MenuRow/MenuRow";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import { buildGithubPullUrl } from "@web/utils/github-pull-url";
import type { InboxItem } from "../../../../types";
import { Icon } from "@web/components/Icon/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./RowActions.module.scss";
import { useRowActionsFacade } from "./useRowActionsFacade";

export interface RowActionsProps {
  item: InboxItem;
  /** The view the row sits in: Archive in the Inbox, Unarchive in the archived view. */
  archived: InboxArchivedFilter;
  /** Page-level live region: the outcome of a copy, an archive or a regenerate. */
  onAnnounce: (message: string) => void;
  /** The reviewer asked to delete this row; the list confirms and runs it. */
  onDelete: (item: InboxItem) => void;
  /** The row left the list; the list decides where focus goes. */
  onRemoved: () => void;
}

/**
 * The right-edge actions a hover or the keyboard cursor reveals: Open on
 * GitHub when the repository is known, and a menu with Copy link, Archive
 * (Unarchive in the archived view) and, on the rows the viewer may delete,
 * Delete. Regenerate leads the menu when GitHub has commits the latest
 * brief does not cover.
 */
export function RowActions({
  item,
  archived,
  onAnnounce,
  onDelete,
  onRemoved,
}: RowActionsProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const href = router.buildLocation({
    to: "/repos/$repoId/pulls/$prNumber",
    params: { repoId: item.repoId, prNumber: String(item.prNumber) },
  }).href;
  const facade = useRowActionsFacade(item, href, onAnnounce, onRemoved);
  const inArchive = archived === InboxArchivedFilters.ONLY;
  const githubUrl = buildGithubPullUrl(item.repoSlug, item.prNumber);
  const canRegenerate = item.behind && githubUrl !== null;

  return (
    <div className={styles["actions"]}>
      {githubUrl === null ? null : (
        <AccessibleLink
          className={styles["link"]}
          href={githubUrl}
          target="_blank"
        >
          <Icon name={IconNames.GITHUB_LOGO} size={IconSizes.MD} />
          <ScreenReaderOnly>
            {t("home.inbox.actions.openOnGithub")}
          </ScreenReaderOnly>
        </AccessibleLink>
      )}
      <Menu
        label={t("home.inbox.actions.more")}
        placement="bottom-end"
        trigger={<Icon name={IconNames.DOTS_THREE} size={IconSizes.MD} />}
        triggerClassName={styles["trigger"]}
      >
        {canRegenerate ? (
          <MenuRow disabled={facade.regenerating} onSelect={facade.regenerate}>
            <span className={styles["rowLabel"]}>
              <Icon name={IconNames.ARROWS_CLOCKWISE} size={IconSizes.MD} />
              {t("home.inbox.actions.regenerate")}
            </span>
          </MenuRow>
        ) : null}
        <MenuRow onSelect={facade.copyLink}>
          <span className={styles["rowLabel"]}>
            <Icon name={IconNames.COPY} size={IconSizes.MD} />
            {t("home.inbox.actions.copyLink")}
          </span>
        </MenuRow>
        <MenuRow
          disabled={facade.archiving}
          onSelect={inArchive ? facade.unarchiveRow : facade.archiveRow}
        >
          <span className={styles["rowLabel"]}>
            <Icon name={IconNames.ARCHIVE} size={IconSizes.MD} />
            {inArchive
              ? t("home.inbox.actions.unarchive")
              : t("home.inbox.actions.archive")}
          </span>
        </MenuRow>
        {item.viewerCanDelete ? (
          <MenuRow className={styles["danger"]} onSelect={() => onDelete(item)}>
            <span className={styles["rowLabel"]}>
              <Icon name={IconNames.TRASH} size={IconSizes.MD} />
              {t("home.inbox.actions.delete")}
            </span>
          </MenuRow>
        ) : null}
      </Menu>
    </div>
  );
}
