import { memo, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { ReviewComment } from "@web/features/review/utils/comments";
import type { Disposition } from "@web/features/review/session";
import {
  useMindMap,
  useMindMapActions,
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
import { RiskBadge } from "../../RiskBadge/RiskBadge";
import { RiskChipDisclosure } from "../../RiskChipDisclosure/RiskChipDisclosure";
import { RiskDetailList } from "../../RiskDetailList/RiskDetailList";
import styles from "./GroupCard.module.scss";

const EMPTY_RISK_FLAGS: RiskFlag[] = [];

export interface GroupCardProps {
  group: GroupView;
  brief: { chunks: BriefChunk[] };
  model: BriefViewModel;
  jumpToChunk: (chunkId: string) => void;
}

function evidenceText(
  disposition: Disposition | undefined,
  comments: ReviewComment[],
  chunks: BriefChunk[],
): string {
  return disposition?.kind === "addressed" && disposition.evidence
    ? riskEvidenceLabel(disposition.evidence, comments, chunks)
    : "addressed without linked evidence";
}

export const GroupCard = memo(function GroupCard({
  group,
  brief,
  model,
  jumpToChunk,
}: GroupCardProps) {
  const dispositions = useMindMap((state) => state.dispositions);
  const dominants = useMindMap((state) => state.dominants);
  const reclassifiedGroups = useMindMap((state) => state.reclassifiedGroups);
  const reviewComments = useMindMap((state) => state.reviewComments);
  const actions = useMindMapActions();
  const {
    announce,
    setDismissTarget,
    setEvidenceTarget,
    toggleRiskFlag,
    toggleRiskGroup,
  } = useReviewActions();
  // Own-draft state (BRIEF-43, ADR 0031): risk flags render as a read-only
  // MIRROR — no author dispositions exist, so every disposition control
  // (checkboxes, Address/Dismiss) disappears while the flags themselves stay
  // fully visible. The author's disposition mechanism is code: fix and push.
  const flagsReadOnly = useReviewFlow((state) => state.flagsReadOnly);

  const dominant = dominants[group.id] ?? group.group.dominantCategory;
  const groupFlags = model.flagsByGroup.get(group.id) ?? EMPTY_RISK_FLAGS;
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
  const isReclassified = reclassifiedGroups.has(group.id);

  function chooseDominant(category: Category) {
    actions.reclassifyGroup(group.id, category);
    announce(`Dominant category set to ${category} — recorded on the receipt.`);
  }

  return (
    <article className={`${styles["card"]} reveal`}>
      <div className={styles["head"]}>
        <div className={styles["eyebrow"]}>
          <span className={styles["number"]}>
            Change-group {group.index + 1} of {model.groups.length}
          </span>
          <span className={styles["loc"]}>
            <span className="green">+{group.added}</span> /{" "}
            <span className="red">−{group.deleted}</span> ·{" "}
            {group.carrierChunks.length} carrier ·{" "}
            {group.supportingChunks.length} supporting
          </span>
        </div>
        <h2 className={styles["title"]}>{group.group.title}</h2>
        <p className={styles["summary"]}>{group.group.summary}</p>
        {group.readingOrderStep !== undefined ? (
          <p className={styles["readingOrder"]}>
            Step {group.readingOrderStep} of {model.groups.length}
            {group.readingOrderWhy ? ` — ${group.readingOrderWhy}` : ""}
          </p>
        ) : null}
        <div className={styles["categoryRow"]}>
          <span className={styles["chip"]} data-kind="dominant">
            <em>dominant</em> {dominant}
          </span>
          {group.group.secondaryCategories.map((category) => (
            <span className={styles["chip"]} key={category}>
              secondary {category}
            </span>
          ))}
          {group.group.uncertain && !isReclassified ? (
            <span className={styles["chip"]} data-kind="uncertain">
              uncertain
            </span>
          ) : null}
          {isReclassified ? (
            <span className={styles["reclassNote"]}>
              set by you · recorded on receipt
            </span>
          ) : null}
        </div>
        {group.headerRisk.shown.length > 0 ||
        group.headerRisk.deEmphasized.length > 0 ? (
          /* Deduped union of member-chunk attributes (ADR 0032 #11): floor
             first, fully-de-emphasized attributes behind "+n". Disclosure,
             never a count-as-severity signal or an aggregate glyph. */
          <div
            aria-label="Risk-surface attributes in this group"
            className={styles["groupRiskRow"]}
            data-testid="group-risk-union"
            role="group"
          >
            {group.headerRisk.shown.map((attr) => {
              // A shown chip means at least one LOUD firing exists — take a
              // loud firing's meta so a quiet-first chunk order can't render
              // the header chip de-emphasized (codex r1).
              const metas = group.chunks
                .map((chunk) => model.riskMetaByChunk.get(chunk.id)?.get(attr))
                .filter((m) => m !== undefined);
              const meta = metas.find((m) => !m.deEmphasized) ?? metas[0];
              if (meta?.source === "repo-policy") {
                return (
                  <RiskChipDisclosure
                    detail={`Defined by repo policy${meta.implication ? ` — ${meta.implication}` : ""}`}
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
                  +{group.headerRisk.deEmphasized.length} de-emphasized
                  <ScreenReaderOnly>
                    {`: ${group.headerRisk.deEmphasized.join(", ")} — de-emphasized by repo policy`}
                  </ScreenReaderOnly>
                </RiskBadge>
              </RiskChipDisclosure>
            ) : null}
          </div>
        ) : null}
        {group.group.uncertain && !isReclassified ? (
          <div className={styles["uncertainPanel"]}>
            <span className={styles["question"]}>
              The categorizer is split on this group’s intent:{" "}
              <b>{group.group.uncertainBetween.join(" vs ")}</b>. Your call; the
              receipt records the override.
            </span>
            <span className={styles["pick"]}>
              {group.group.uncertainBetween.map((category) => (
                <button
                  className={styles["pickButton"]}
                  key={category}
                  type="button"
                  onClick={() => chooseDominant(category)}
                >
                  {category}
                </button>
              ))}
            </span>
          </div>
        ) : null}
      </div>
      {/* The scrollable region under the fixed head; keyboard-reachable with
          the label on the element that scrolls, so they coincide. */}
      <div
        aria-label={`${group.group.title} — risk surface`}
        className={styles["body"]}
        role="region"
        tabIndex={0}
      >
        <div className={styles["flags"]}>
          <div className={`${styles["label"]} ${styles["riskLabel"]}`}>
            <span>
              Risk surface — {groupFlags.length} flags{" "}
              <span className={styles["count"]}>attributes, not verdicts</span>
            </span>
            {/* The popover documents the disposition controls — it goes with
                them in the read-only mirror (nothing dangling). */}
            {flagsReadOnly ? null : (
              <span className={styles["riskInfo"]}>
                <button
                  aria-describedby={`${group.id}-risk-help`}
                  aria-label="Risk surface status meanings"
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
                    <b>Addressed:</b> this risk was reviewed and handled.
                  </span>
                  <span>
                    <b>Dismissed:</b> this risk is not applicable, duplicate, or
                    a false positive.
                  </span>
                </span>
              </span>
            )}
          </div>
          {groupFlags.length === 0 ? (
            <p className={styles["empty"]}>
              No risk-surface attributes on this group.
            </p>
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
            // the section title drops the amber prominence (codex r13).
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
                      <button
                        className={styles["button"]}
                        disabled={!hasSelection}
                        title="Mark selected risks as reviewed and handled"
                        type="button"
                        onClick={() => {
                          setEvidenceTarget({
                            flagIds: openRiskFlagIds.filter((flagId) =>
                              selectedFlagSet.has(flagId),
                            ),
                            label: `${selectedCount} ${selectedCount === 1 ? "flag" : "flags"} in ${riskGroup.attr}`,
                          });
                        }}
                      >
                        Address selected
                      </button>
                      <button
                        className={styles["button"]}
                        disabled={!hasSelection}
                        title="Mark selected risks as not applicable"
                        type="button"
                        onClick={() => {
                          setDismissTarget({
                            flagIds: openRiskFlagIds.filter((flagId) =>
                              selectedFlagSet.has(flagId),
                            ),
                            label: `${selectedCount} ${selectedCount === 1 ? "flag" : "flags"} in ${riskGroup.attr}`,
                          });
                        }}
                      >
                        Dismiss selected…
                      </button>
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
                              aria-label={`Select ${flag.attr} flag for ${flag.file}`}
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
                          <button
                            className={styles["fileButton"]}
                            type="button"
                            onClick={() => jumpToChunk(flag.chunkId)}
                          >
                            {flag.file}
                          </button>
                          {isResolved ? (
                            <span className={styles["state"]}>{kind}</span>
                          ) : null}
                        </div>
                        {!isResolved ? (
                          <>
                            <div className={styles["description"]}>
                              {flag.description}
                            </div>
                            {flag.source === "repo-policy" ? (
                              <div
                                className={styles["description"]}
                                data-kind="repo-policy-source"
                              >
                                Defined by repo policy
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
                                De-emphasized by repo policy
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
                                <button
                                  className={styles["button"]}
                                  title="Mark this risk as reviewed and handled"
                                  type="button"
                                  onClick={() => {
                                    setEvidenceTarget({
                                      flagIds: [flag.id],
                                      label: `${flag.attr} @ ${flag.file}`,
                                    });
                                  }}
                                >
                                  Addressed
                                </button>
                                <button
                                  className={styles["button"]}
                                  title="Mark this risk as not applicable"
                                  type="button"
                                  onClick={() =>
                                    setDismissTarget({
                                      flagIds: [flag.id],
                                      label: `${flag.attr} @ ${flag.file}`,
                                    })
                                  }
                                >
                                  Dismiss…
                                </button>
                              </div>
                            )}
                          </>
                        ) : kind === "addressed" ? (
                          <div className={styles["stateDetail"]}>
                            {evidenceText(
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
