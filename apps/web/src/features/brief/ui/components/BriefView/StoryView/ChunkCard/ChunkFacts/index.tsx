import { useTranslation } from "react-i18next";
import type { FileStatus } from "brief-core/chunk-layout";

import type { BriefChunk } from "../../../../../../model/types";
import type { AttributeDisplayMeta } from "../../../../../../model/utils/repo-config";
import { isUnattributedRemainderChunk } from "../../../../../../model/utils/remainder";
import {
  getConcernLabel,
  riskChipView,
} from "../../../../../../model/utils/view-model";
import { FileStatusBadge } from "../FileStatusBadge";
import { ReadAsBadge } from "../ReadAsBadge";
import { RoleBadge } from "../RoleBadge";
import styles from "./ChunkFacts.module.scss";
import { OverflowRiskChip } from "./OverflowRiskChip";
import { RiskChip } from "./RiskChip";

export interface ChunkFactsProps {
  chunk: BriefChunk;
  /** Per-attribute display meta for THIS chunk; absent = plain built-in chips. */
  riskMeta?: ReadonlyMap<string, AttributeDisplayMeta> | undefined;
  fileStatus: FileStatus | undefined;
  draftCount: number;
  reviewCommentCount: number;
  /** The review comments are ones this chunk addresses, not stray ones on its file. */
  addressesComments: boolean;
}

/**
 * What a chunk is, as chips: its risk attributes, concern, role, file status,
 * how the model read it, and the comments on it. The head shows them beside
 * the path; the phone chunk menu shows them as read-only facts.
 */
export function ChunkFacts({
  chunk,
  riskMeta,
  fileStatus,
  draftCount,
  reviewCommentCount,
  addressesComments,
}: ChunkFactsProps) {
  const { t } = useTranslation();
  const riskChips = riskChipView(chunk.riskSurface);
  const concernLabel = getConcernLabel(t, chunk.concern);
  const reviewCountLabel = addressesComments
    ? t("brief.chunk.addressedCount", { count: reviewCommentCount })
    : t("brief.chunk.reviewCount", { count: reviewCommentCount });

  return (
    <span className={styles["facts"]}>
      {riskChips.shown.length > 0 ? (
        <span className={styles["riskLane"]}>
          {riskChips.shown.map((risk) => (
            <RiskChip key={risk} meta={riskMeta?.get(risk)} risk={risk} />
          ))}
          {riskChips.overflow.length > 0 ? (
            <OverflowRiskChip attrs={riskChips.overflow} riskMeta={riskMeta} />
          ) : null}
        </span>
      ) : null}
      {isUnattributedRemainderChunk(chunk) ? null : (
        <>
          <span className={styles["chip"]} data-concern={chunk.concern}>
            <span className={styles["dot"]} />
            {concernLabel}
          </span>
          <RoleBadge role={chunk.role} />
          {fileStatus !== undefined ? (
            <FileStatusBadge status={fileStatus} />
          ) : null}
          {chunk.readAs !== undefined ? (
            <ReadAsBadge readAs={chunk.readAs} />
          ) : null}
        </>
      )}
      {draftCount > 0 ? (
        <span className={styles["chip"]}>
          {t("brief.chunk.drafts", { count: draftCount })}
        </span>
      ) : null}
      {reviewCommentCount > 0 ? (
        <span className={styles["chip"]}>{reviewCountLabel}</span>
      ) : null}
    </span>
  );
}
