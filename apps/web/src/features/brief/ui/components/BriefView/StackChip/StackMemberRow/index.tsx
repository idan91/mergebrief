import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

import { AccessibleLink } from "@web/components/AccessibleLink";
import { Icon } from "@web/components/Icon";
import { IconSizes } from "@web/components/Icon/types";
import { PR_STATE_BADGE_ICONS } from "../../consts";
import { NeighbourTargetKinds, type StackRow } from "../types";
import {
  resolveMemberStateVariant,
  resolveNeighbourTarget,
  resolveStackMemberLabel,
} from "../utils";
import styles from "./StackMemberRow.module.scss";

export interface StackMemberRowProps {
  row: StackRow;
  repoSlug: string;
  repoId: string | undefined;
}

/**
 * One PR of the stack: its place, title, number and branch, with its state
 * glyph when the live read knows it, as a link to its brief (the app route
 * when the repo is known, GitHub otherwise) or, for the PR on screen, the
 * row that stays put.
 */
export function StackMemberRow({ row, repoSlug, repoId }: StackMemberRowProps) {
  const { t } = useTranslation();
  const { member } = row;
  const label = resolveStackMemberLabel(t, member);
  const positionText = row.position === undefined ? "" : String(row.position);
  const metaText =
    member.headRef === undefined
      ? `#${String(member.number)}`
      : t("brief.header.stackMemberBranch", {
          number: member.number,
          branch: member.headRef,
        });
  const stateVariant = resolveMemberStateVariant(member.state);
  const content = (
    <>
      <span className={styles["position"]}>{positionText}</span>
      <span className={styles["text"]}>
        <span className={styles["title"]}>{member.title}</span>
        <span className={styles["meta"]}>{metaText}</span>
      </span>
      {stateVariant === undefined ? null : (
        <span className={styles["state"]} data-state={stateVariant}>
          <Icon name={PR_STATE_BADGE_ICONS[stateVariant]} size={IconSizes.LG} />
        </span>
      )}
    </>
  );

  if (row.current) {
    return (
      <span
        aria-current="true"
        aria-label={label}
        className={styles["row"]}
        title={label}
      >
        {content}
      </span>
    );
  }

  const target = resolveNeighbourTarget(member, repoId, repoSlug);
  if (target.kind === NeighbourTargetKinds.ROUTE) {
    return (
      <Link
        aria-label={label}
        className={styles["row"]}
        params={target.params}
        search={target.search}
        title={label}
        to="/repos/$repoId/pulls/$prNumber"
      >
        {content}
      </Link>
    );
  }

  if (target.kind === NeighbourTargetKinds.NONE) {
    return (
      <span aria-label={label} className={styles["row"]} title={label}>
        {content}
      </span>
    );
  }
  const githubLabel = `${label}${t("a11y.opensInNewTab")}`;
  return (
    <AccessibleLink
      aria-label={githubLabel}
      className={styles["row"]}
      href={target.href}
      target="_blank"
      title={label}
    >
      {content}
    </AccessibleLink>
  );
}
