import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import clsx from "clsx";

import { AccessibleLink } from "@web/components/AccessibleLink";
import type { PrStackMember } from "../../../../../types";
import { MemberRow } from "../MemberRow";
import { NeighbourTargetKinds } from "../types";
import { resolveNeighbourTarget } from "../utils";
import styles from "./NeighbourLink.module.scss";

export interface NeighbourLinkProps {
  member: PrStackMember;
  currentNumber: number;
  repoSlug: string;
  repoId: string | undefined;
  label: string;
}

export function NeighbourLink({
  member,
  currentNumber,
  repoSlug,
  repoId,
  label,
}: NeighbourLinkProps) {
  const { t } = useTranslation();
  const isCurrent = member.number === currentNumber;
  const rowClass = clsx(styles["row"], styles["link"]);
  const currentClass = clsx(styles["row"], styles["current"]);

  if (isCurrent) {
    return (
      <span
        aria-current="true"
        aria-label={label}
        className={currentClass}
        title={label}
      >
        <MemberRow member={member} />
      </span>
    );
  }

  const target = resolveNeighbourTarget(member, repoId, repoSlug);
  if (target.kind === NeighbourTargetKinds.ROUTE) {
    return (
      <Link
        aria-label={label}
        className={rowClass}
        params={target.params}
        title={label}
        to="/repos/$repoId/pulls/$prNumber"
      >
        <MemberRow member={member} />
      </Link>
    );
  }

  if (target.kind === NeighbourTargetKinds.NONE) {
    return (
      <span aria-label={label} className={styles["row"]} title={label}>
        <MemberRow member={member} />
      </span>
    );
  }
  const githubLabel = `${label}${t("a11y.opensInNewTab")}`;
  return (
    <AccessibleLink
      aria-label={githubLabel}
      className={rowClass}
      href={target.href}
      title={label}
      target="_blank"
    >
      <MemberRow member={member} />
    </AccessibleLink>
  );
}
