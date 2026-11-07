import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { AccessibleLink } from "@web/components/AccessibleLink";
import { BottomSheet } from "@web/components/BottomSheet";
import { BreakablePath } from "@web/components/BreakablePath";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import type { ChunkShare } from "../../../types";
import { FIRST_ACTION_SELECTOR } from "./consts";
import { CopyRow } from "./CopyRow";
import styles from "./ChunkActionsSheet.module.scss";

export interface ChunkActionsSheetProps {
  chunkId: string;
  /** The path as the head shows it, hidden characters escaped. */
  displayFile: string;
  /** The path as stored, what Copy file path writes. */
  filePath: string;
  /** The chunk's chips, read-only here. */
  facts: ReactNode;
  requestComment: () => void;
  shareChunk?: ChunkShare | undefined;
  /** The file on GitHub at the brief's head; absent hides the row. */
  githubUrl?: string | undefined;
  close: () => void;
}

/** The phone chunk menu: what the chunk is, then the actions the head has no room for. */
export function ChunkActionsSheet({
  chunkId,
  displayFile,
  filePath,
  facts,
  requestComment,
  shareChunk,
  githubUrl,
  close,
}: ChunkActionsSheetProps) {
  const { t } = useTranslation();

  const handleComment = () => {
    close();
    requestComment();
  };

  return (
    <BottomSheet
      close={close}
      closeLabel={t("brief.mobile.closeChunkActions")}
      initialFocusSelector={FIRST_ACTION_SELECTOR}
      label={t("brief.mobile.chunkActions")}
      testId="chunk-actions-sheet"
    >
      <div className={styles["summary"]}>
        <p className={styles["path"]}>
          <bdi dir="ltr">
            <BreakablePath path={displayFile} />
          </bdi>
        </p>
        {facts}
      </div>
      <div className={styles["rows"]}>
        {/* oxlint-disable-next-line house/no-raw-button -- a full-width sheet row, which the shared buttons do not model */}
        <button
          className={styles["row"]}
          data-first-action=""
          type="button"
          onClick={handleComment}
        >
          {t("review.comment.commentOnFile")}
          <Icon name={IconNames.CHAT_TEXT} size={IconSizes.MD} />
        </button>
        <CopyRow
          className={styles["row"]}
          label={t("brief.chunk.copyFilePath")}
          text={filePath}
        />
        {shareChunk === undefined ? null : (
          <CopyRow
            className={styles["row"]}
            label={t("brief.chunk.copyLink")}
            onCopy={() => shareChunk.commit(chunkId)}
            text={() => shareChunk.deriveUrl(chunkId)}
          />
        )}
        {githubUrl === undefined ? null : (
          <AccessibleLink
            className={styles["row"]}
            href={githubUrl}
            target="_blank"
          >
            {t("shell.media.openOnGithub")}
            <Icon name={IconNames.ARROW_UP_RIGHT} size={IconSizes.MD} />
          </AccessibleLink>
        )}
      </div>
    </BottomSheet>
  );
}
