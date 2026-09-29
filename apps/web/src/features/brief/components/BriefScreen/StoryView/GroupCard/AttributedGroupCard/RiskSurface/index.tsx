import { useTranslation } from "react-i18next";

import type {
  Disposition,
  ReviewFlowActions,
} from "@web/features/review/session";
import { Button } from "@web/components/Button";
import type {
  AttributedGroupView,
  RiskFlag,
} from "../../../../../../utils/viewModel";
import cardStyles from "../../GroupCard.module.scss";
import { FileRow } from "./FileRow";
import { ResolvedFold } from "./ResolvedFold";
import styles from "./RiskSurface.module.scss";
import { groupFlagsByFile } from "./utils";

export interface RiskSurfaceProps {
  group: AttributedGroupView;
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
}: RiskSurfaceProps) {
  const { t } = useTranslation();
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

  return (
    <div
      aria-label={t("brief.group.ariaLabelGroupRiskSurface", {
        title: group.group.title,
      })}
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
              title={t("brief.group.titleMarkSelectedAddressed")}
              onClick={() => {
                setEvidenceTarget({
                  flagIds: selectedIds,
                  label: t("brief.group.flagsIn", {
                    count: selectedCount,
                    attr: heading,
                  }),
                });
              }}
            >
              {t("brief.group.addressSelected")}
            </Button>
            <Button
              size="sm"
              title={t("brief.group.titleMarkSelectedDismissed")}
              onClick={() => {
                setDismissTarget({
                  flagIds: selectedIds,
                  label: t("brief.group.flagsIn", {
                    count: selectedCount,
                    attr: heading,
                  }),
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
            {openRows.map((row) => (
              <FileRow
                dispositions={dispositions}
                flagsReadOnly={flagsReadOnly}
                jumpToChunk={jumpToChunk}
                key={row.file}
                reopenFlag={reopenFlag}
                row={row}
                selectedFlagSet={selectedFlagSet}
                toggleRiskGroup={toggleRiskGroup}
              />
            ))}
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
