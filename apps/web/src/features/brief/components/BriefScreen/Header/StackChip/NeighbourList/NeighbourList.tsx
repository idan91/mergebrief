import { useTranslation } from "react-i18next";

import type { PrStackMember } from "../../../../../types";
import { NeighbourLink } from "../NeighbourLink/NeighbourLink";
import styles from "./NeighbourList.module.scss";

export interface NeighbourListProps {
  members: readonly PrStackMember[];
  currentNumber: number;
  prUrl: string;
  repoId: string | undefined;
  labelled?: boolean;
}

export function NeighbourList({
  members,
  currentNumber,
  prUrl,
  repoId,
  labelled = false,
}: NeighbourListProps) {
  const { t } = useTranslation();
  const listLabel = labelled
    ? t("brief.header.stackDisclosureAria")
    : undefined;
  const rows = members.map((member) => ({
    member,
    label: t("brief.header.stackMember", {
      number: member.number,
      title: member.title,
    }),
  }));

  return (
    <ul aria-label={listLabel} className={styles["list"]}>
      {rows.map((row) => (
        <li className={styles["item"]} key={row.member.number}>
          <NeighbourLink
            currentNumber={currentNumber}
            label={row.label}
            member={row.member}
            prUrl={prUrl}
            repoId={repoId}
          />
        </li>
      ))}
    </ul>
  );
}
