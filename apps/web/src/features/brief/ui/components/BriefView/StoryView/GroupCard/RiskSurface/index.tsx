import { useTranslation } from "react-i18next";

import type {
  Disposition,
  ReviewFlowActions,
} from "@web/features/review/session";
import { Button } from "@web/components/Button";
import { resolveGroupName } from "../../../../../../model/utils/resolve-group-name";
import type {
  GroupView,
  RiskFlag,
} from "../../../../../../model/utils/view-model";
import { useReadingPositionIfMounted } from "../../../reading/reading-position";
import cardStyles from "../GroupCard.module.scss";
import { FileRow } from "./FileRow";
import { ResolvedFold } from "./ResolvedFold";
import styles from "./RiskSurface.module.scss";
import { getChunkFile, groupFlagsByFile } from "./utils";

export interface RiskSurfaceProps {
  group: GroupView;
  groupFlags: RiskFlag[];
  /** The files to list rows in; the group's own chunk order by default. */
  fileOrder?: string[] | undefined;
  dispositions: Record<string, Disposition | undefined>;
  flagsReadOnly: boolean;
  selectedFlagSet: Set<string>;
  jumpToChunk: (chunkId: string) => void;
  reopenFlag: (flag: RiskFlag) => void;
  setDismissTarget: ReviewFlowActions["setDismissTarget"];
  setEvidenceTarget: ReviewFlowActions["setEvidenceTarget"];
  toggleRiskGroup: ReviewFlowActions["toggleRiskGroup"];
  /** Marks the row of the file the reader is in; the card's surface only. */
  followsReader?: boolean;
}

export function RiskSurface({
  group,
  groupFlags,
  fileOrder: fileOrderOverride,
  dispositions,
  flagsReadOnly,
  selectedFlagSet,
  jumpToChunk,
  reopenFlag,
  setDismissTarget,
  setEvidenceTarget,
  toggleRiskGroup,
  followsReader = false,
}: RiskSurfaceProps) {
  const { t } = useTranslation();
  const readerFile = useReadingPositionIfMounted((state) =>
    followsReader && state.activeGroupId === group.id
      ? getChunkFile(group.chunks, state.activeChunkId)
      : undefined,
  );
  const fileOrder =
    fileOrderOverride ?? group.chunks.map((chunk) => chunk.file);
  const rows = groupFlagsByFile(groupFlags, dispositions, fileOrder);
  const openRows = rows.filter((row) => row.openFlags.length > 0);
  const resolvedRows = rows.filter((row) => row.openFlags.length === 0);
  const selectedIds = [...selectedFlagSet];
  const selectedCount = selectedIds.length;
  const fileCount = rows.length;
  const flagCount = groupFlags.length;
  const heading = t("brief.group.riskSurface");
  const regionLabel = t("brief.group.ariaLabelGroupRiskSurface", {
    title: resolveGroupName(t, group),
  });
  const selectedFlagsLabel = t("brief.group.selectedFlags", {
    count: selectedCount,
  });

  return (
    <div
      aria-label={regionLabel}
      className={cardStyles["body"]}
      role="region"
      tabIndex={0}
    >
      <div className={styles["inner"]}>
        <div className={styles["sectionHead"]}>
          <h3 className={styles["heading"]}>{heading}</h3>
          <span className={styles["counts"]}>
            <span>{t("brief.group.filesCount", { count: fileCount })}</span>
            <span>{t("brief.group.flagsCount", { count: flagCount })}</span>
          </span>
        </div>
        {selectedCount > 0 && !flagsReadOnly ? (
          <div className={styles["toolbar"]}>
            <Button
              size="sm"
              onClick={() => {
                setEvidenceTarget({
                  flagIds: selectedIds,
                  label: selectedFlagsLabel,
                });
              }}
            >
              {t("brief.group.addressSelected")}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDismissTarget({
                  flagIds: selectedIds,
                  label: selectedFlagsLabel,
                });
              }}
            >
              {t("brief.group.dismissSelected")}
            </Button>
          </div>
        ) : null}
        {flagCount === 0 ? (
          <p className={styles["empty"]}>{t("brief.group.noGroupFlags")}</p>
        ) : null}
        {openRows.length > 0 ? (
          <ul className={styles["list"]}>
            {openRows.map((row) => {
              const current = row.file === readerFile;

              return (
                <FileRow
                  current={current}
                  dispositions={dispositions}
                  flagsReadOnly={flagsReadOnly}
                  jumpToChunk={jumpToChunk}
                  key={row.file}
                  reopenFlag={reopenFlag}
                  row={row}
                  selectedFlagSet={selectedFlagSet}
                  toggleRiskGroup={toggleRiskGroup}
                />
              );
            })}
          </ul>
        ) : null}
        {resolvedRows.length > 0 ? (
          <ResolvedFold
            dispositions={dispositions}
            flagsReadOnly={flagsReadOnly}
            jumpToChunk={jumpToChunk}
            reopenFlag={reopenFlag}
            rows={resolvedRows}
          />
        ) : null}
      </div>
    </div>
  );
}
