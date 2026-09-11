import { Link } from "@tanstack/react-router";

import { AccessibleLink } from "@web/components/AccessibleLink/AccessibleLink";
import type { PrStackMember } from "../../../../../types";
import { rewritePullUrl } from "../utils";
import styles from "./NeighbourLink.module.scss";

export interface NeighbourLinkProps {
  member: PrStackMember;
  currentNumber: number;
  prUrl: string;
  repoId: string | undefined;
  label: string;
}

export function NeighbourLink({
  member,
  currentNumber,
  prUrl,
  repoId,
  label,
}: NeighbourLinkProps) {
  const isCurrent = member.number === currentNumber;
  if (isCurrent) {
    return (
      <span aria-current="true" className={styles["current"]}>
        {label}
      </span>
    );
  }

  if (repoId !== undefined) {
    const params = { repoId, prNumber: String(member.number) };
    return (
      <Link
        className={styles["link"]}
        params={params}
        to="/repos/$repoId/pulls/$prNumber"
      >
        {label}
      </Link>
    );
  }

  const href = rewritePullUrl(prUrl, member.number);
  if (href === undefined) {
    return <span>{label}</span>;
  }
  return (
    <AccessibleLink className={styles["link"]} href={href} target="_blank">
      {label}
    </AccessibleLink>
  );
}
