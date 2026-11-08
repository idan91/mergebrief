import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  type InboxArchivedFilter,
  InboxArchivedFilters,
  PullRequestSources,
} from "types";

import { AccessibleLink } from "@web/components/AccessibleLink";
import { IconButton } from "@web/components/IconButton";
import { Menu } from "@web/components/Menu";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { isRerunHopeless } from "@web/utils/failure-class";
import { buildGithubPullUrl } from "@web/utils/github-pull-url";
import type { InboxItem } from "../../../../types";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./RowActions.module.scss";
import { useRowActionsFacade } from "./useRowActionsFacade";
import { openOnGithub } from "./utils";

export interface RowActionsProps {
  item: InboxItem;
  /** The view the row sits in: Archive in the Inbox, Unarchive in the archived view. */
  archived: InboxArchivedFilter;
  /** A restore is pending, so Archive waits for it. */
  archiveHeld: boolean;
  /** Every matching row is being read for a bulk action, so Delete waits. */
  deleteHeld: boolean;
  /** Page-level live region: the outcome of a copy, an archive or a regenerate. */
  onAnnounce: (message: string) => void;
  onArchived: (message: string, gone: readonly InboxItem[]) => void;
  /** The reviewer asked to delete this row; the list confirms and runs it. */
  onDelete: (item: InboxItem) => void;
  /** The reviewer asked to delete the repository's attachment branch; the list confirms and runs it. */
  onPurgeAttachments: (item: InboxItem) => void;
  /** The row left the list; the list decides where focus goes. */
  onRemoved: () => void;
}

/**
 * The right-edge actions a hover or the keyboard cursor reveals: Open on
 * GitHub when the repository is known, hidden on a touch screen, and a menu
 * with Copy link, Open on GitHub, Archive (Unarchive in the archived view)
 * and, on the rows the viewer may delete, Delete. An installation row an
 * admin may delete also offers the repository's attachment-branch purge.
 * Regenerate leads the menu when GitHub has commits the latest brief does
 * not cover, unless the latest generation failed in a way a repeat paste
 * fails again.
 */
export function RowActions({
  item,
  archived,
  archiveHeld,
  deleteHeld,
  onAnnounce,
  onArchived,
  onDelete,
  onPurgeAttachments,
  onRemoved,
}: RowActionsProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const href = router.buildLocation({
    to: "/repos/$repoId/pulls/$prNumber",
    params: { repoId: item.repoId, prNumber: String(item.prNumber) },
  }).href;
  const facade = useRowActionsFacade(
    item,
    archived,
    href,
    onAnnounce,
    onRemoved,
    onArchived,
  );
  const inArchive = archived === InboxArchivedFilters.ONLY;
  const archiveDisabled = facade.archiving || archiveHeld;
  const githubUrl = buildGithubPullUrl(item.repoSlug, item.prNumber);
  // Regenerate takes the paste path, so only a url row can use it.
  const canRegenerate =
    item.behind &&
    item.source === PullRequestSources.URL &&
    githubUrl !== undefined &&
    !isRerunHopeless(item.generation);
  const deleteHeldReason = deleteHeld
    ? t("home.inbox.actions.deleteHeld")
    : undefined;
  const canPurgeAttachments =
    item.viewerCanDelete && item.source === PullRequestSources.INSTALLATION;

  return (
    <div className={styles["actions"]}>
      {githubUrl === undefined ? null : (
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
      <Menu placement="bottom-end">
        <Menu.Trigger>
          <IconButton
            className={styles["trigger"]}
            label={t("home.inbox.actions.more")}
            size="md"
            variant="ghost"
          >
            <Icon name={IconNames.DOTS_THREE} size={IconSizes.MD} />
          </IconButton>
        </Menu.Trigger>
        <Menu.Content>
          {canRegenerate ? (
            <Menu.Item
              disabled={facade.regenerating}
              glyph={
                <Icon name={IconNames.ARROWS_CLOCKWISE} size={IconSizes.MD} />
              }
              onSelect={facade.regenerate}
            >
              {t("home.inbox.actions.regenerate")}
            </Menu.Item>
          ) : null}
          <Menu.Item
            glyph={<Icon name={IconNames.COPY} size={IconSizes.MD} />}
            onSelect={facade.copyLink}
          >
            {t("home.inbox.actions.copyLink")}
          </Menu.Item>
          {githubUrl === undefined ? null : (
            <Menu.Item
              glyph={<Icon name={IconNames.GITHUB_LOGO} size={IconSizes.MD} />}
              onSelect={() => openOnGithub(githubUrl)}
            >
              {t("home.inbox.actions.openOnGithub")}
            </Menu.Item>
          )}
          <Menu.Item
            disabled={archiveDisabled}
            glyph={<Icon name={IconNames.ARCHIVE} size={IconSizes.MD} />}
            onSelect={facade.toggleArchive}
          >
            {inArchive
              ? t("home.inbox.actions.unarchive")
              : t("home.inbox.actions.archive")}
          </Menu.Item>
          {item.viewerCanDelete ? (
            <Menu.Item
              danger
              glyph={<Icon name={IconNames.TRASH} size={IconSizes.MD} />}
              unavailableReason={deleteHeldReason}
              onSelect={() => onDelete(item)}
            >
              {t("home.inbox.actions.delete")}
            </Menu.Item>
          ) : null}
          {canPurgeAttachments ? (
            <Menu.Item
              danger
              glyph={<Icon name={IconNames.IMAGE} size={IconSizes.MD} />}
              onSelect={() => onPurgeAttachments(item)}
            >
              {t("home.inbox.actions.purgeAttachments")}
            </Menu.Item>
          ) : null}
        </Menu.Content>
      </Menu>
    </div>
  );
}
