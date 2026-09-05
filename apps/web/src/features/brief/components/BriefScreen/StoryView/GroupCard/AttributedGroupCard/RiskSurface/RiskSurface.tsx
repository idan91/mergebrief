import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { ReviewComment } from "@web/features/review/utils/comments";
import type { Disposition } from "@web/features/review/session";
import type { ReviewFlowActions } from "@web/features/review/session/flow/store";
import { riskEvidenceLabel } from "@web/features/review/utils/state";
import { Button } from "@web/components/Button/Button";
import { LinkButton } from "@web/components/LinkButton/LinkButton";
import type { BriefChunk } from "../../../../../../types";
import {
  groupRiskByAttribute,
  riskFlagDescription,
  type AttributedGroupView,
  type RiskFlag,
} from "../../../../../../utils/viewModel";
import styles from "../../GroupCard.module.scss";

export interface RiskSurfaceProps {
  group: AttributedGroupView;
  groupFlags: RiskFlag[];
  dispositions: Record<string, Disposition | undefined>;
  flagsReadOnly: boolean;
  selectedFlagSet: Set<string>;
  reviewComments: ReviewComment[];
  chunks: BriefChunk[];
  jumpToChunk: (chunkId: string) => void;
  reopenFlag: (flag: RiskFlag) => void;
  setDismissTarget: ReviewFlowActions["setDismissTarget"];
  setEvidenceTarget: ReviewFlowActions["setEvidenceTarget"];
  toggleRiskFlag: ReviewFlowActions["toggleRiskFlag"];
  toggleRiskGroup: ReviewFlowActions["toggleRiskGroup"];
}

function getEvidenceText(
  t: TFunction,
  disposition: Disposition | undefined,
  comments: ReviewComment[],
  chunks: BriefChunk[],
): string {
  return disposition?.kind === "addressed" && disposition.evidence
    ? riskEvidenceLabel(t, disposition.evidence, comments, chunks)
    : t("review.summary.addressedWithoutEvidence");
}

export function RiskSurface({
  group,
  groupFlags,
  dispositions,
  flagsReadOnly,
  selectedFlagSet,
  reviewComments,
  chunks,
  jumpToChunk,
  reopenFlag,
  setDismissTarget,
  setEvidenceTarget,
  toggleRiskFlag,
  toggleRiskGroup,
}: RiskSurfaceProps) {
  const { t } = useTranslation();

  return (
    <div
      aria-label={t("brief.group.ariaLabelGroupRiskSurface", {
        title: group.group.title,
      })}
      className={styles["body"]}
      role="region"
      tabIndex={0}
    >
      <div className={styles["flags"]}>
        <div className={`${styles["label"]} ${styles["riskLabel"]}`}>
          <span>
            {t("brief.group.riskSurfaceCount", { count: groupFlags.length })}{" "}
            <span className={styles["count"]}>
              {t("brief.group.attributesNotVerdicts")}
            </span>
          </span>
          {flagsReadOnly ? null : (
            <span className={styles["riskInfo"]}>
              {/* eslint-disable-next-line no-restricted-syntax -- tooltip anchor (cursor: help, no onClick): not an action */}
              <button
                aria-describedby={`${group.id}-risk-help`}
                aria-label={t("brief.group.ariaLabelStatusMeanings")}
                className={styles["infoButton"]}
                type="button"
              >
                i
              </button>
              <span
                className={styles["riskInfoPopover"]}
                id={`${group.id}-risk-help`}
                role="tooltip"
              >
                <span>
                  <b>{t("brief.group.addressedLead")}</b>{" "}
                  {t("brief.group.addressedBody")}
                </span>
                <span>
                  <b>{t("brief.group.dismissedLead")}</b>{" "}
                  {t("brief.group.dismissedBody")}
                </span>
              </span>
            </span>
          )}
        </div>
        {groupFlags.length === 0 ? (
          <p className={styles["empty"]}>{t("brief.group.noGroupFlags")}</p>
        ) : null}
        {groupRiskByAttribute(groupFlags).map((riskGroup) => {
          const openRiskFlagIds = riskGroup.flags
            .filter(
              (flag) => (dispositions[flag.id]?.kind ?? "open") === "open",
            )
            .map((flag) => flag.id);
          const selectedCount = openRiskFlagIds.filter((flagId) =>
            selectedFlagSet.has(flagId),
          ).length;
          const allSelected =
            openRiskFlagIds.length > 0 &&
            selectedCount === openRiskFlagIds.length;
          const hasSelection = selectedCount > 0;
          const allQuiet = riskGroup.flags.every((flag) => flag.deEmphasized);
          return (
            <div
              className={styles["riskGroup"]}
              data-deemphasized={allQuiet ? "" : undefined}
              key={riskGroup.attr}
            >
              <div className={styles["riskGroupHead"]}>
                {flagsReadOnly ? (
                  <span className={styles["riskCheck"]}>
                    <span className={styles["riskGroupTitle"]}>
                      {riskGroup.attr}
                    </span>
                  </span>
                ) : (
                  <label className={styles["riskCheck"]}>
                    <input
                      className={styles["checkbox"]}
                      checked={allSelected}
                      disabled={openRiskFlagIds.length === 0}
                      suppressHydrationWarning
                      type="checkbox"
                      onChange={() => toggleRiskGroup(openRiskFlagIds)}
                    />
                    <span className={styles["riskGroupTitle"]}>
                      {riskGroup.attr}
                    </span>
                  </label>
                )}
                {flagsReadOnly ? null : (
                  <div className={styles["riskBulkActions"]}>
                    <Button
                      disabled={!hasSelection}
                      size="sm"
                      title={t("brief.group.titleMarkSelectedAddressed")}
                      onClick={() => {
                        setEvidenceTarget({
                          flagIds: openRiskFlagIds.filter((flagId) =>
                            selectedFlagSet.has(flagId),
                          ),
                          label: t("brief.group.flagsIn", {
                            count: selectedCount,
                            attr: riskGroup.attr,
                          }),
                        });
                      }}
                    >
                      {t("brief.group.addressSelected")}
                    </Button>
                    <Button
                      disabled={!hasSelection}
                      size="sm"
                      title={t("brief.group.titleMarkSelectedDismissed")}
                      onClick={() => {
                        setDismissTarget({
                          flagIds: openRiskFlagIds.filter((flagId) =>
                            selectedFlagSet.has(flagId),
                          ),
                          label: t("brief.group.flagsIn", {
                            count: selectedCount,
                            attr: riskGroup.attr,
                          }),
                        });
                      }}
                    >
                      {t("brief.group.dismissSelected")}
                    </Button>
                  </div>
                )}
              </div>
              <div className={styles["riskFiles"]}>
                {riskGroup.flags.map((flag) => {
                  const disposition = dispositions[flag.id];
                  const kind = disposition?.kind ?? "open";
                  const isResolved = kind !== "open";
                  return (
                    <div
                      className={styles["flag"]}
                      data-disposition={kind}
                      data-source={flag.source}
                      data-deemphasized={flag.deEmphasized ? "" : undefined}
                      data-state={isResolved ? "resolved" : "open"}
                      key={flag.id}
                    >
                      <div className={styles["flagRow"]}>
                        {flagsReadOnly ? null : (
                          <input
                            aria-label={t("brief.group.ariaLabelSelectFlag", {
                              attr: flag.attr,
                              file: flag.file,
                            })}
                            checked={
                              !isResolved && selectedFlagSet.has(flag.id)
                            }
                            className={styles["checkbox"]}
                            disabled={isResolved}
                            suppressHydrationWarning
                            type="checkbox"
                            onChange={() => toggleRiskFlag(flag.id)}
                          />
                        )}
                        <LinkButton
                          className={styles["fileButton"]}
                          onClick={() => jumpToChunk(flag.chunkId)}
                        >
                          {flag.file}
                        </LinkButton>
                        {isResolved ? (
                          <span className={styles["state"]}>{kind}</span>
                        ) : null}
                        {kind === "dismissed" && !flagsReadOnly ? (
                          <Button
                            aria-label={t("brief.group.ariaLabelReopen", {
                              attr: flag.attr,
                              file: flag.file,
                            })}
                            className={styles["reopen"]}
                            size="sm"
                            variant="quiet"
                            title={t("brief.group.titleReopen")}
                            onClick={() => reopenFlag(flag)}
                          >
                            {t("brief.group.reopen")}
                          </Button>
                        ) : null}
                      </div>
                      {!isResolved ? (
                        <>
                          <div className={styles["description"]}>
                            {riskFlagDescription(t, flag)}
                          </div>
                          {flag.source === "repo-policy" ? (
                            <div
                              className={styles["description"]}
                              data-kind="repo-policy-source"
                            >
                              {t("brief.group.definedByRepoPolicy")}
                              {flag.implication ? ` — ${flag.implication}` : ""}
                            </div>
                          ) : null}
                          {flag.deEmphasized ? (
                            <div
                              className={styles["description"]}
                              data-kind="deemphasized-note"
                            >
                              {t("brief.group.deEmphasizedByRepoPolicy")}
                            </div>
                          ) : null}
                          {flag.note ? (
                            <div
                              className={styles["description"]}
                              data-kind="risk-note"
                            >
                              {flag.note}
                            </div>
                          ) : null}
                          {flagsReadOnly ? null : (
                            <div className={styles["flagActions"]}>
                              <Button
                                size="sm"
                                title={t("brief.group.titleMarkAddressed")}
                                onClick={() => {
                                  setEvidenceTarget({
                                    flagIds: [flag.id],
                                    label: `${flag.attr} @ ${flag.file}`,
                                  });
                                }}
                              >
                                {t("brief.group.addressed")}
                              </Button>
                              <Button
                                size="sm"
                                title={t("brief.group.titleMarkDismissed")}
                                onClick={() =>
                                  setDismissTarget({
                                    flagIds: [flag.id],
                                    label: `${flag.attr} @ ${flag.file}`,
                                  })
                                }
                              >
                                {t("brief.group.dismiss")}
                              </Button>
                            </div>
                          )}
                        </>
                      ) : kind === "addressed" ? (
                        <div className={styles["stateDetail"]}>
                          {getEvidenceText(t, disposition, reviewComments, chunks)}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
