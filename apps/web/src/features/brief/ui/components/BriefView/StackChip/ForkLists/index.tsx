import { useTranslation } from "react-i18next";

import type { ForkPrStack } from "../../../../../model/types";
import { NeighbourList } from "../NeighbourList";
import { deriveForkRows } from "../utils";
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
  const parentRows = deriveForkRows(parentMembers, currentNumber);
  const childRows = deriveForkRows(stack.children, currentNumber);
  const stackedOn = t("brief.header.stackedOn");
  const stackedWith = t("brief.header.stackedWith");

  return (
    <>
      {parentRows.length > 0 ? (
        <>
          <span className={styles["leadIn"]}>{stackedOn}</span>
          <NeighbourList
            repoSlug={repoSlug}
            repoId={repoId}
            rows={parentRows}
          />
        </>
      ) : null}
      <span className={styles["leadIn"]}>{stackedWith}</span>
      <NeighbourList repoSlug={repoSlug} repoId={repoId} rows={childRows} />
    </>
  );
}
