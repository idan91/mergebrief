import { useTranslation } from "react-i18next";

import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";

import { categoryLabel, GroupViewKinds } from "../../../../../utils/viewModel";
import type { GroupView } from "../../../../../utils/viewModel";
import { resolveGroupName } from "../../../../../utils/resolveGroupName";
import type { JumpFromSidebar } from "../../types";
import styles from "./ThisPr.module.scss";

export interface ThisPrProps {
  groups: GroupView[];
  activeGroupId: string | null;
  conversationGroupIds?: ReadonlySet<string> | undefined;
  jumpToGroup: JumpFromSidebar;
}

/** The This PR tab's content: the change groups in Brief order, the current one marked, each row a jump. */
export function ThisPr({
  groups,
  activeGroupId,
  conversationGroupIds,
  jumpToGroup,
}: ThisPrProps) {
  const { t } = useTranslation();

  return (
    <div className={styles["panel"]}>
      <ol className={styles["list"]}>
        {groups.map((group) => {
          const current = group.id === activeGroupId;
          const hasConversation = conversationGroupIds?.has(group.id) ?? false;
          return (
            <li key={group.id}>
              {/* oxlint-disable-next-line house/no-raw-button -- two-line list row on an alignment grid: block content the shared Button does not model */}
              <button
                aria-current={current ? "true" : undefined}
                className={styles["row"]}
                data-current={current ? "" : undefined}
                type="button"
                onClick={(event) => jumpToGroup(group.id, event)}
              >
                <span aria-hidden="true" className={styles["ordinal"]}>
                  {group.index + 1}
                </span>
                <span className={styles["name"]}>
                  {resolveGroupName(t, group)}
                </span>
                <span className={styles["meta"]}>
                  {group.kind === GroupViewKinds.ATTRIBUTED ? (
                    <>
                      <span className={styles["category"]}>
                        {categoryLabel(group.group.dominantCategory)}
                      </span>
                      <span className={styles["counts"]}>
                        {t("brief.group.chunkCounts", {
                          core: group.coreChunks.length,
                          supporting: group.supportingChunks.length,
                        })}
                      </span>
                    </>
                  ) : (
                    <span className={styles["counts"]}>
                      <span className="green">+{group.added}</span>{" "}
                      <span className="red">−{group.deleted}</span>
                    </span>
                  )}
                </span>
                {hasConversation ? (
                  <span className={styles["marker"]}>
                    <ScreenReaderOnly>
                      {t("brief.toc.srHasConversation")}
                    </ScreenReaderOnly>
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
