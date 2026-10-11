import { useTranslation } from "react-i18next";

import type { PrStackMember } from "../../../../../model/types";
import { NeighbourLink } from "../NeighbourLink";
import styles from "./NeighbourList.module.scss";

export interface NeighbourListProps {
  members: readonly PrStackMember[];
  currentNumber: number;
  repoSlug: string;
  repoId: string | undefined;
  /** Accessible name for the list; absent inside a labelled panel. */
  label?: string | undefined;
}

export function NeighbourList({
  members,
  currentNumber,
  repoSlug,
  repoId,
  label,
}: NeighbourListProps) {
  const { t } = useTranslation();
  const rows = members.map((member) => ({
    member,
    label: t("brief.header.stackMember", {
      number: member.number,
      title: member.title,
    }),
  }));

  return (
    <ul aria-label={label} className={styles["list"]}>
      {rows.map((row) => (
        <li className={styles["item"]} key={row.member.number}>
          <NeighbourLink
            currentNumber={currentNumber}
            label={row.label}
            member={row.member}
            repoSlug={repoSlug}
            repoId={repoId}
          />
        </li>
      ))}
    </ul>
  );
}
