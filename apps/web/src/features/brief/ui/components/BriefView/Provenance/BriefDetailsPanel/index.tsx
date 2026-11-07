import { LocalBriefKinds } from "contract";
import { useTranslation } from "react-i18next";
import { formatDisplayPath } from "brief-core/hidden-chars";

import { Callout } from "@web/components/Callout";
import { Chip } from "@web/components/Chip";
import { IconButton } from "@web/components/IconButton";
import { LocSign, LocSigns } from "@web/components/LocSign";
import type { Brief } from "../../../../../model/types";
import type { ConcernShare } from "../../Masthead/types";
import {
  getRepoConfigOutcomeLabel,
  type RepoConfigContext,
} from "../../../../../model/utils/repo-config";
import { getArtifactKindLabel } from "../../../../../model/utils/view-model";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";
import styles from "./BriefDetailsPanel.module.scss";
import { GenerationWarnings } from "./GenerationWarnings";
import { ShaCopy } from "./ShaCopy";
import { SplitSection } from "./SplitSection";
import { DetailsSurfaces } from "./types";
import { useBriefDetailsPanelFacade } from "./useBriefDetailsPanelFacade";
import { listWarningLines } from "./utils";

export interface BriefDetailsPanelProps {
  brief: Brief;
  /** Adjusted-line totals from the view model, the Artifact section's LOC line. */
  totalAdded: number;
  totalDeleted: number;
  /** Core-chunk derived-line totals from the view model. */
  totalCoreAdded: number;
  totalCoreDeleted: number;
  /** Repo-config snapshot; absent/null → the section reports "no config". */
  repoConfig?: RepoConfigContext | null | undefined;
  /** The concern Split; the panel lists each share's lines. Absent leaves the section out. */
  shares?: readonly ConcernShare[] | undefined;
}

/**
 * The ⓘ Brief-details disclosure and the generation-warnings chip, co-located
 * so ONE close path owns focus return; a close that leaves keyboard focus on
 * an unmounted portal node would dump it on <body>. Each trigger opens its own
 * surface, and one is open at a time.
 *
 * Hover previews either surface, click is canonical, Escape-at-capture
 * dismisses without reaching page shortcuts.
 */
export function BriefDetailsPanel({
  brief,
  totalAdded,
  totalDeleted,
  totalCoreAdded,
  totalCoreDeleted,
  repoConfig,
  shares,
}: BriefDetailsPanelProps) {
  const { t } = useTranslation();
  const {
    surfaceId,
    factsOpen,
    warningsOpen,
    triggerEl,
    setTriggerEl,
    chipEl,
    setChipEl,
    setWarningsNode,
    closeOnLeave,
    toggle,
    activateWarnings,
    previewOnHover,
    endHover,
  } = useBriefDetailsPanelFacade();
  const warnings = listWarningLines(t, brief);
  const factsControls = factsOpen ? surfaceId : undefined;
  const warningsControls = warningsOpen ? surfaceId : undefined;

  return (
    <>
      <span
        className={styles["hoverArea"]}
        // Hover preview is a MOUSE affordance; touch/pen go through click
        // (touch browsers synthesize mouseenter before click, so a
        // hover-open would be immediately toggled shut). A preview never
        // clobbers a pinned surface.
        onPointerEnter={(event) =>
          previewOnHover(DetailsSurfaces.FACTS, event.pointerType)
        }
        onPointerLeave={() => endHover(DetailsSurfaces.FACTS)}
      >
        <IconButton
          aria-controls={factsControls}
          aria-expanded={factsOpen}
          className={styles["trigger"]}
          data-brief-details-trigger=""
          label={t("brief.details.ariaLabelTrigger")}
          ref={setTriggerEl}
          onClick={() => toggle(DetailsSurfaces.FACTS)}
        >
          <span aria-hidden="true">i</span>
        </IconButton>
        {factsOpen && triggerEl ? (
          <Callout
            anchor={triggerEl}
            fit
            interactive
            placement="bottom-start"
            onClose={(reason) => closeOnLeave(DetailsSurfaces.FACTS, reason)}
          >
            <span className={styles["panel"]} id={surfaceId}>
              <ArtifactSection
                brief={brief}
                totalAdded={totalAdded}
                totalDeleted={totalDeleted}
                totalCoreAdded={totalCoreAdded}
                totalCoreDeleted={totalCoreDeleted}
              />
              {shares ? <SplitSection shares={shares} /> : null}
              <GenerationSection brief={brief} />
              <RepoConfigSection repoConfig={repoConfig} />
            </span>
          </Callout>
        ) : null}
      </span>
      {warnings.length > 0 ? (
        <span
          className={styles["hoverArea"]}
          onPointerEnter={(event) =>
            previewOnHover(DetailsSurfaces.WARNINGS, event.pointerType)
          }
          onPointerLeave={() => endHover(DetailsSurfaces.WARNINGS)}
        >
          <Chip
            aria-controls={warningsControls}
            aria-expanded={warningsOpen}
            className={styles["warningsChip"]}
            data-generation-warnings-chip=""
            ref={setChipEl}
            tone="warning"
            onClick={activateWarnings}
          >
            <Icon name={IconNames.WARNING} size={IconSizes.SM} />
            <span>
              {t("brief.details.warnings", { count: warnings.length })}
            </span>
          </Chip>
        </span>
      ) : null}
      {warningsOpen && chipEl ? (
        <Callout
          anchor={chipEl}
          fit
          interactive
          placement="bottom-start"
          onClose={(reason) => closeOnLeave(DetailsSurfaces.WARNINGS, reason)}
        >
          <span className={styles["panel"]} id={surfaceId}>
            <GenerationWarnings ref={setWarningsNode} warnings={warnings} />
          </span>
        </Callout>
      ) : null}
    </>
  );
}

export interface ArtifactSectionProps {
  brief: Brief;
  totalAdded: number;
  totalDeleted: number;
  totalCoreAdded: number;
  totalCoreDeleted: number;
}

function ArtifactSection({
  brief,
  totalAdded,
  totalDeleted,
  totalCoreAdded,
  totalCoreDeleted,
}: ArtifactSectionProps) {
  const { t } = useTranslation();
  const artifactKindLabel = getArtifactKindLabel(t, brief.artifactKind);
  return (
    <section className={styles["section"]} data-details-section="artifact">
      <h2 className={styles["heading"]}>
        {t("brief.details.artifactHeading")}
      </h2>
      <dl className={styles["facts"]}>
        <dt>{t("brief.details.kind")}</dt>
        <dd>{artifactKindLabel}</dd>
        {brief.artifactKind === LocalBriefKinds.BRIEF && brief.commitRange ? (
          <>
            <dt>{t("brief.details.commitRange")}</dt>
            <dd className={styles["shaRange"]}>
              <ShaCopy sha={brief.commitRange.base} />
              <span aria-hidden="true">..</span>
              <ShaCopy sha={brief.commitRange.head} />
              <span>
                {t("brief.details.commits", {
                  count: brief.commitRange.commitCount,
                })}
              </span>
            </dd>
          </>
        ) : null}
        {brief.artifactKind === LocalBriefKinds.DELTA &&
        brief.baselineSha &&
        brief.headSha ? (
          <>
            <dt>{t("brief.details.span")}</dt>
            <dd className={styles["shaRange"]}>
              <ShaCopy sha={brief.baselineSha} />
              <Icon
                name={IconNames.ARROW_UP}
                rotation={IconRotations.QUARTER}
                size={IconSizes.SM}
              />
              <ShaCopy sha={brief.headSha} />
            </dd>
          </>
        ) : null}
        <dt>{t("brief.details.changedLines")}</dt>
        <dd>
          <LocSign sign={LocSigns.ADD} count={totalAdded} />{" "}
          <LocSign sign={LocSigns.DEL} count={totalDeleted} />
        </dd>
        <dt>{t("brief.details.coreLines")}</dt>
        <dd>
          <LocSign sign={LocSigns.ADD} count={totalCoreAdded} />{" "}
          <LocSign sign={LocSigns.DEL} count={totalCoreDeleted} />
        </dd>
      </dl>
      <p className={styles["caveat"]}>
        <b>{t("brief.details.countsCaveatLead")}</b>{" "}
        {t("brief.details.countsCaveatBody")}
      </p>
    </section>
  );
}

export interface GenerationSectionProps {
  brief: Brief;
}

function GenerationSection({ brief }: GenerationSectionProps) {
  const { t } = useTranslation();
  const generation = brief.generation;
  return (
    <section className={styles["section"]} data-details-section="generation">
      <h2 className={styles["heading"]}>
        {t("brief.details.generationHeading")}
      </h2>
      {generation ? (
        <dl className={styles["facts"]}>
          <dt>{t("brief.details.provider")}</dt>
          <dd>{generation.provider}</dd>
          <dt>{t("brief.details.model")}</dt>
          <dd className={styles["modelId"]}>{generation.model}</dd>
          {generation.effort ? (
            <>
              <dt>{t("brief.details.effort")}</dt>
              <dd>{generation.effort}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p className={styles["caveat"]}>{t("brief.details.noOriginStamp")}</p>
      )}
    </section>
  );
}

export interface RepoConfigSectionProps {
  repoConfig: RepoConfigContext | null | undefined;
}

function RepoConfigSection({ repoConfig }: RepoConfigSectionProps) {
  const { t } = useTranslation();
  const anyPresent =
    repoConfig !== null &&
    repoConfig !== undefined &&
    (repoConfig.files.some((file) => file.outcome !== "absent") ||
      repoConfig.collisions.length > 0);
  const presentFiles =
    repoConfig?.files.filter((file) => file.outcome !== "absent") ?? [];
  const presentRows = presentFiles.map((file) => {
    const outcomeLabel = getRepoConfigOutcomeLabel(t, file.outcome);
    const displayPath = formatDisplayPath(file.path);
    return { file, displayPath, outcomeLabel };
  });
  const collisions = repoConfig?.collisions ?? [];
  const collisionsLine =
    collisions.length > 0
      ? t("brief.details.collisionsLine", {
          count: collisions.length,
          names: collisions.join(", "),
        })
      : undefined;
  return (
    <section className={styles["section"]} data-details-section="repo-config">
      <h2 className={styles["heading"]}>
        {t("brief.details.repoConfigHeading")}
      </h2>
      {!anyPresent ? (
        <p className={styles["caveat"]}>{t("brief.details.noRepoConfig")}</p>
      ) : (
        // Slimmed on purpose: bytes-of-budget and per-file blob SHAs stay
        // out; the warning-state chip's own callout keeps the full table.
        <ul className={styles["configList"]}>
          {presentRows.map(({ file, displayPath, outcomeLabel }) => (
            <li key={file.path}>
              <code>{displayPath}</code>
              <span data-outcome={file.outcome}>{outcomeLabel}</span>
              {file.warning ? <i>{file.warning}</i> : null}
            </li>
          ))}
          {collisionsLine !== undefined ? (
            <li>
              <i>{collisionsLine}</i>
            </li>
          ) : null}
        </ul>
      )}
    </section>
  );
}
