import { useTranslation } from "react-i18next";

import type { ForkPrStack } from "../../../../../types";
import { NeighbourList } from "../NeighbourList";
import styles from "./ForkLists.module.scss";

export interface ForkListsProps {
  stack: ForkPrStack;
  currentNumber: number;
  repoSlug: string;
  repoId: string | undefined;
}

export function ForkLists({
  stack,
  currentNumber,
  repoSlug,
  repoId,
}: ForkListsProps) {
  const { t } = useTranslation();
  const parentMembers = stack.parent === undefined ? [] : [stack.parent];
  const stackedOn = t("brief.header.stackedOn");
  const stackedWith = t("brief.header.stackedWith");

  return (
    <>
      {parentMembers.length > 0 ? (
        <>
          <span className={styles["leadIn"]}>{stackedOn}</span>
          <NeighbourList
            currentNumber={currentNumber}
            members={parentMembers}
            repoSlug={repoSlug}
            repoId={repoId}
          />
        </>
      ) : null}
      <span className={styles["leadIn"]}>{stackedWith}</span>
      <NeighbourList
        currentNumber={currentNumber}
        members={stack.children}
        repoSlug={repoSlug}
        repoId={repoId}
      />
    </>
  );
}
