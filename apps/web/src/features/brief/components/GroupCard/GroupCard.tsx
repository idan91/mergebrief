import type { ReviewComment } from "../../../review/comments";
import type { DismissTarget } from "../../../review/components/DismissModal/DismissModal";
import type { EvidenceTarget } from "../../../review/components/EvidenceModal/EvidenceModal";
import type { Disposition } from "../../../review/session";
import { useMindMap, useMindMapActions } from "../../../review/session";
import { riskEvidenceLabel } from "../../../review/state";
import type { BriefChunk, Category } from "../../types";
import {
  groupRiskByAttribute,
  type BriefViewModel,
  type GroupView,
} from "../../viewModel";

export interface GroupCardProps {
  group: GroupView;
  brief: { chunks: BriefChunk[] };
  model: BriefViewModel;
  selectedRiskFlags: Set<string>;
  jumpToChunk: (chunkId: string) => void;
  setDismissTarget: (target: DismissTarget) => void;
  setEvidenceTarget: (target: EvidenceTarget) => void;
  setToast: (message: string) => void;
  toggleRiskFlag: (flagId: string) => void;
  toggleRiskGroup: (flagIds: string[]) => void;
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

export function GroupCard({
  group,
  brief,
  model,
  selectedRiskFlags,
  jumpToChunk,
  setDismissTarget,
  setEvidenceTarget,
  setToast,
  toggleRiskFlag,
  toggleRiskGroup,
}: GroupCardProps) {
  const dispositions = useMindMap((state) => state.dispositions);
  const dominants = useMindMap((state) => state.dominants);
  const reclassifiedGroups = useMindMap((state) => state.reclassifiedGroups);
  const reviewComments = useMindMap((state) => state.reviewComments);
  const actions = useMindMapActions();

  const dominant = dominants[group.id] ?? group.group.dominantCategory;
  const groupFlags = model.flags.filter((flag) => flag.groupId === group.id);
  const isReclassified = reclassifiedGroups.has(group.id);

  function chooseDominant(category: Category) {
    actions.reclassifyGroup(group.id, category);
    setToast(`Dominant category set to ${category} — recorded on the receipt.`);
  }

  return (
    <article className="group-card reveal">
      <div className="group-head">
        <div className="group-eyebrow">
          <span className="gnum">
            Change-group {group.index + 1} of {model.groups.length}
          </span>
          <span className="gloc">
            <span className="green">+{group.added}</span> /{" "}
            <span className="red">−{group.deleted}</span> ·{" "}
            {group.carrierChunks.length} carrier ·{" "}
            {group.supportingChunks.length} supporting
          </span>
        </div>
        <h2 className="group-title">{group.group.title}</h2>
        <p className="group-summary">{group.group.summary}</p>
        <div className="cat-row">
          <span className="chip dominant">
            <em>dominant</em> {dominant}
          </span>
          {group.group.secondaryCategories.map((category) => (
            <span className="chip" key={category}>
              secondary {category}
            </span>
          ))}
          {group.group.uncertain && !isReclassified ? (
            <span className="chip uncertain">uncertain</span>
          ) : null}
          {isReclassified ? (
            <span className="reclass-note">
              set by you · recorded on receipt
            </span>
          ) : null}
        </div>
        {group.group.uncertain && !isReclassified ? (
          <div className="uncertain-panel">
            <span className="q">
              The categorizer is split on this group’s intent:{" "}
              <b>{group.group.uncertainBetween.join(" vs ")}</b>. Your call; the
              receipt records the override.
            </span>
            <span className="pick">
              {group.group.uncertainBetween.map((category) => (
                <button
                  className="pickbtn"
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
      <div className="group-body">
        <div className="flags">
          <div className="label risk-label">
            <span>
              Risk surface — {groupFlags.length} flags{" "}
              <span className="count">attributes, not verdicts</span>
            </span>
            <span className="risk-info">
              <button
                aria-describedby={`${group.id}-risk-help`}
                aria-label="Risk surface status meanings"
                className="info-button"
                type="button"
              >
                i
              </button>
              <span
                className="risk-info-popover"
                id={`${group.id}-risk-help`}
                role="tooltip"
              >
                <span>
                  <b>Addressed:</b> this risk was reviewed and handled.
                </span>
                <span>
                  <b>Dismissed:</b> this risk is not applicable, duplicate, or a
                  false positive.
                </span>
              </span>
            </span>
          </div>
          {groupFlags.length === 0 ? (
            <p className="empty">No risk-surface attributes on this group.</p>
          ) : null}
          {groupRiskByAttribute(groupFlags).map((riskGroup) => {
            const openRiskFlagIds = riskGroup.flags
              .filter(
                (flag) => (dispositions[flag.id]?.kind ?? "open") === "open",
              )
              .map((flag) => flag.id);
            const selectedCount = openRiskFlagIds.filter((flagId) =>
              selectedRiskFlags.has(flagId),
            ).length;
            const allSelected =
              openRiskFlagIds.length > 0 &&
              selectedCount === openRiskFlagIds.length;
            const hasSelection = selectedCount > 0;
            return (
              <div className="risk-group" key={riskGroup.attr}>
                <div className="risk-group-head">
                  <label className="risk-check">
                    <input
                      checked={allSelected}
                      disabled={openRiskFlagIds.length === 0}
                      suppressHydrationWarning
                      type="checkbox"
                      onChange={() => toggleRiskGroup(openRiskFlagIds)}
                    />
                    <span className="risk-group-title">{riskGroup.attr}</span>
                  </label>
                  <div className="risk-bulk-actions">
                    <button
                      className="fbtn"
                      disabled={!hasSelection}
                      title="Mark selected risks as reviewed and handled"
                      type="button"
                      onClick={() => {
                        setEvidenceTarget({
                          flagIds: openRiskFlagIds.filter((flagId) =>
                            selectedRiskFlags.has(flagId),
                          ),
                          label: `${selectedCount} ${selectedCount === 1 ? "flag" : "flags"} in ${riskGroup.attr}`,
                        });
                      }}
                    >
                      Address selected
                    </button>
                    <button
                      className="fbtn"
                      disabled={!hasSelection}
                      title="Mark selected risks as not applicable"
                      type="button"
                      onClick={() => {
                        setDismissTarget({
                          flagIds: openRiskFlagIds.filter((flagId) =>
                            selectedRiskFlags.has(flagId),
                          ),
                          label: `${selectedCount} ${selectedCount === 1 ? "flag" : "flags"} in ${riskGroup.attr}`,
                        });
                      }}
                    >
                      Dismiss selected…
                    </button>
                  </div>
                </div>
                <div className="risk-files">
                  {riskGroup.flags.map((flag) => {
                    const disposition = dispositions[flag.id];
                    const kind = disposition?.kind ?? "open";
                    const isResolved = kind !== "open";
                    return (
                      <div
                        className={`flag ${isResolved ? `resolved ${kind}` : ""}`}
                        key={flag.id}
                      >
                        <div className="frow">
                          <input
                            aria-label={`Select ${flag.attr} flag for ${flag.file}`}
                            checked={
                              !isResolved && selectedRiskFlags.has(flag.id)
                            }
                            className="flag-check"
                            disabled={isResolved}
                            suppressHydrationWarning
                            type="checkbox"
                            onChange={() => toggleRiskFlag(flag.id)}
                          />
                          <button
                            className="floc full-path"
                            type="button"
                            onClick={() => jumpToChunk(flag.chunkId)}
                          >
                            {flag.file}
                          </button>
                          {isResolved ? (
                            <span className="fstate compact">{kind}</span>
                          ) : null}
                        </div>
                        {!isResolved ? (
                          <>
                            <div className="fdesc">{flag.description}</div>
                            <div className="factions">
                              <button
                                className="fbtn"
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
                                className="fbtn"
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
                          </>
                        ) : kind === "addressed" ? (
                          <div className="fstate-detail">
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
}
