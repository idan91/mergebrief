import { riskFlagDescription } from "../../../../utils/viewModel";
import type { TFunction } from "i18next";
import { Trans, useTranslation } from "react-i18next";
import { memo, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { ReviewComment } from "@web/features/review/utils/comments";
import type { Disposition } from "@web/features/review/session";
import {
  useReviewSession,
  useReviewSessionActions,
  useReviewActions,
  useReviewFlow,
} from "@web/features/review/session";
import { riskEvidenceLabel } from "@web/features/review/utils/state";
import type { BriefChunk, Category } from "../../../../types";
import {
  groupRiskByAttribute,
  type BriefViewModel,
  type GroupView,
  type RiskFlag,
} from "../../../../utils/viewModel";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import { CoreLinesDisclosure } from "../../CoreLinesDisclosure/CoreLinesDisclosure";
import { RiskBadge } from "../../RiskBadge/RiskBadge";
import { RiskChipDisclosure } from "../../RiskChipDisclosure/RiskChipDisclosure";
import { RiskDetailList } from "../../RiskDetailList/RiskDetailList";
import { SinceMarker } from "./SinceMarker/SinceMarker";
import { Button } from "@web/components/Button/Button";
import { LinkButton } from "@web/components/LinkButton/LinkButton";
import styles from "./GroupCard.module.scss";
import { selectGroupReviewComments } from "./utils";

const EMPTY_RISK_FLAGS: RiskFlag[] = [];

export interface GroupCardProps {
  group: GroupView;
  brief: { chunks: BriefChunk[] };
  model: BriefViewModel;
  jumpToChunk: (chunkId: string) => void;
  /**
   * Changed-since marker inputs, primitives so the memo boundary survives
   * parent re-renders. Marker renders iff the shortsha is present
   * (a checkpoint exists); count 0 = "unchanged since your last review".
   */
  sinceChangedFileCount?: number | undefined;
  sinceBaselineShortSha?: string | undefined;
  /** Opens the delta lens; route-owned, stable (memo boundary rides on it). */
  openDeltaLens?: (() => void) | undefined;
}

function evidenceText(
  t: TFunction,
  disposition: Disposition | undefined,
  comments: ReviewComment[],
  chunks: BriefChunk[],
): string {
  return disposition?.kind === "addressed" && disposition.evidence
    ? riskEvidenceLabel(t, disposition.evidence, comments, chunks)
    : t("review.summary.addressedWithoutEvidence");
}

export const GroupCard = memo(function GroupCard({
  group,
  brief,
  model,
  jumpToChunk,
  sinceChangedFileCount,
  sinceBaselineShortSha,
  openDeltaLens,
}: GroupCardProps) {
  const { t } = useTranslation();
  const groupFlags = model.flagsByGroup.get(group.id) ?? EMPTY_RISK_FLAGS;
  // GROUP-SCOPED store slices: whole-map subscriptions would re-render every
  // card (in BOTH kept-warm scope panes) on any disposition/comment write
  // anywhere in the brief. Each selector is primitive- or shallow-stable
  // while this group's own slice is unchanged.
  const dominant = useReviewSession(
    (state) => state.dominants[group.id] ?? group.group.dominantCategory,
  );
  const isReclassified = useReviewSession((state) =>
    state.reclassifiedGroups.has(group.id),
  );
  const groupDispositions = useReviewSession(
    useShallow((state) =>
      groupFlags.map((flag) => state.dispositions[flag.id]),
    ),
  );
  const dispositions = useMemo(() => {
    const byId: Record<string, Disposition | undefined> = {};
    groupFlags.forEach((flag, index) => {
      byId[flag.id] = groupDispositions[index];
    });
    return byId;
  }, [groupDispositions, groupFlags]);
  // Evidence rendering needs comments this group can reference: anchored on
  // its own chunks, plus any comment a flag's addressed evidence links.
  const groupChunkIds = useMemo(
    () => new Set(group.chunks.map((chunk) => chunk.id)),
    [group.chunks],
  );
  const reviewComments = useReviewSession(
    useShallow((state) =>
      selectGroupReviewComments(state, groupFlags, groupChunkIds),
    ),
  );
  const actions = useReviewSessionActions();
  const {
    announce,
    setDismissTarget,
    setEvidenceTarget,
    toggleRiskFlag,
    toggleRiskGroup,
  } = useReviewActions();
  // In the own-draft state risk flags are a read-only MIRROR — no author
  // dispositions exist, so every disposition control disappears while the
  // flags themselves stay fully visible.
  const flagsReadOnly = useReviewFlow((state) => state.flagsReadOnly);

  // Selection-intersection subscription: this card re-renders only when the
  // selection WITHIN its own flags changes, not on any selection anywhere —
  // the GroupCard memo boundary's win.
  const groupFlagIds = useMemo(
    () => groupFlags.map((flag) => flag.id),
    [groupFlags],
  );
  const selectedRiskFlags = useReviewFlow(
    useShallow((state) =>
      groupFlagIds.filter((id) => state.selectedRiskFlags.has(id)),
    ),
  );
  const selectedFlagSet = useMemo(
    () => new Set(selectedRiskFlags),
    [selectedRiskFlags],
  );

  // The narrow undo for a mis-dismissed risk: back to `open`, one flag at a
  // time. No wide reset exists any more, so this is the only path back.
  function reopenFlag(flag: RiskFlag) {
    actions.disposeFlag([flag.id], { kind: "open" });
    announce(t("brief.group.reopenAnnounce"));
  }

  function chooseDominant(category: Category) {
    actions.reclassifyGroup(group.id, category);
    announce(t("brief.story.dominantAnnounce", { category }));
  }

  return (
    <article className={`${styles["card"]} reveal`}>
      <div className={styles["head"]}>
        <div className={styles["eyebrow"]}>
          <span className={styles["number"]}>
            {t("brief.group.changeGroupOf", {
              index: group.index + 1,
              total: model.groups.length,
            })}
          </span>
          {/* Owns the eyebrow's right edge, so adding a metric cannot move
              the anchor. */}
          <div className={styles["metrics"]}>
            <CoreLinesDisclosure
              allAdded={group.added}
              allDeleted={group.deleted}
              className={styles["loc"]}
              coreAdded={group.coreAdded}
              coreDeleted={group.coreDeleted}
            >
              <span className="green">+{group.coreAdded}</span> /{" "}
              <span className="red">−{group.coreDeleted}</span>{" "}
              {t("brief.group.coreSuffix")} ·{" "}
              {t("brief.group.chunkCounts", {
                core: group.coreChunks.length,
                supporting: group.supportingChunks.length,
              })}
            </CoreLinesDisclosure>
            {sinceBaselineShortSha !== undefined ? (
              <SinceMarker
                baselineShortSha={sinceBaselineShortSha}
                changedFileCount={sinceChangedFileCount ?? 0}
                openDeltaLens={openDeltaLens}
              />
            ) : null}
          </div>
        </div>
        <h2 className={styles["title"]}>{group.group.title}</h2>
        <p className={styles["summary"]}>{group.group.summary}</p>
        {group.readingOrderStep !== undefined ? (
          <p className={styles["readingOrder"]}>
            {t("brief.group.stepOf", {
              step: group.readingOrderStep,
              total: model.groups.length,
            })}
            {group.readingOrderWhy ? ` — ${group.readingOrderWhy}` : ""}
          </p>
        ) : null}
        <div className={styles["categoryRow"]}>
          <span className={styles["chip"]} data-kind="dominant">
            <em>{t("brief.group.dominant")}</em> {dominant}
          </span>
          {group.group.secondaryCategories.map((category) => (
            <span className={styles["chip"]} key={category}>
              {t("brief.group.secondary", { category })}
            </span>
          ))}
          {group.group.uncertain && !isReclassified ? (
            <span className={styles["chip"]} data-kind="uncertain">
              {t("brief.group.uncertain")}
            </span>
          ) : null}
          {isReclassified ? (
            <span className={styles["reclassNote"]}>
              {t("brief.group.reclassNote")}
            </span>
          ) : null}
        </div>
        {group.headerRisk.shown.length > 0 ||
        group.headerRisk.deEmphasized.length > 0 ? (
          /* Deduped union of member-chunk attributes: floor first,
             fully-de-emphasized attributes behind "+n". Disclosure, never a
             count-as-severity signal or an aggregate glyph. */
          <div
            aria-label={t("brief.group.ariaLabelGroupRisks")}
            className={styles["groupRiskRow"]}
            data-testid="group-risk-union"
            role="group"
          >
            {group.headerRisk.shown.map((attr) => {
              // A shown chip means at least one LOUD firing exists — take a
              // loud firing's meta so a quiet-first chunk order can't render
              // the header chip de-emphasized.
              const metas = group.chunks
                .map((chunk) => model.riskMetaByChunk.get(chunk.id)?.get(attr))
                .filter((m) => m !== undefined);
              const meta = metas.find((m) => !m.deEmphasized) ?? metas[0];
              if (meta?.source === "repo-policy") {
                return (
                  <RiskChipDisclosure
                    detail={
                      meta.implication !== undefined
                        ? t("brief.riskBadge.repoPolicyWithImplication", {
                            implication: meta.implication,
                          })
                        : t("brief.riskBadge.repoPolicyLead")
                    }
                    key={attr}
                  >
                    <RiskBadge meta={meta}>{attr}</RiskBadge>
                  </RiskChipDisclosure>
                );
              }
              return (
                <RiskBadge key={attr} meta={meta}>
                  {attr}
                </RiskBadge>
              );
            })}
            {group.headerRisk.deEmphasized.length > 0 ? (
              <RiskChipDisclosure
                detail={
                  <RiskDetailList
                    attrs={group.headerRisk.deEmphasized}
                    metaFor={(attr) =>
                      group.chunks
                        .map((chunk) =>
                          model.riskMetaByChunk.get(chunk.id)?.get(attr),
                        )
                        .find((m) => m !== undefined)
                    }
                  />
                }
              >
                <RiskBadge meta={{ source: "built-in", deEmphasized: true }}>
                  {t("brief.group.deEmphasizedCount", {
                    count: group.headerRisk.deEmphasized.length,
                  })}
                  <ScreenReaderOnly>
                    {t("brief.group.srDeEmphasizedList", {
                      attrs: group.headerRisk.deEmphasized.join(", "),
                    })}
                  </ScreenReaderOnly>
                </RiskBadge>
              </RiskChipDisclosure>
            ) : null}
          </div>
        ) : null}
        {group.group.uncertain && !isReclassified && !flagsReadOnly ? (
          <div className={styles["uncertainPanel"]}>
            <span className={styles["question"]}>
              <Trans
                components={[
                  <b key="between">
                    {group.group.uncertainBetween.join(
                      t("brief.group.uncertainSeparator"),
                    )}
                  </b>,
                ]}
                i18nKey="brief.group.splitIntent"
              />
            </span>
            <span className={styles["pick"]}>
              {group.group.uncertainBetween.map((category) => (
                <Button key={category} onClick={() => chooseDominant(category)}>
                  {category}
                </Button>
              ))}
            </span>
          </div>
        ) : null}
      </div>
      {/* The scrollable region under the fixed head; keyboard-reachable with
          the label on the element that scrolls, so they coincide. */}
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
            {/* The popover documents the disposition controls — it goes with
                them in the read-only mirror (nothing dangling). */}
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
            // Fully-quiet attribute section: every firing de-emphasized →
            // the section title drops the amber prominence.
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
                                {flag.implication
                                  ? ` — ${flag.implication}`
                                  : ""}
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
                            {evidenceText(
                              t,
                              disposition,
                              reviewComments,
                              brief.chunks,
                            )}
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
    </article>
  );
});
