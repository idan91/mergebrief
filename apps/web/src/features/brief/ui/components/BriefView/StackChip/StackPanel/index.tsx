import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  SegmentedControl,
  type SegmentedOption,
} from "@web/components/SegmentedControl";
import { formatDate, renderedLocale } from "@web/i18n/locale";
import type { PrStack } from "../../../../../model/types";
import { StackBase } from "../StackBase";
import { StackLists } from "../StackLists";
import { StackVersions, type StackVersion } from "../types";
import { resolveShownStack } from "../utils";
import { StackVersionCell } from "./StackVersionCell";
import styles from "./StackPanel.module.scss";

export interface StackPanelProps {
  stack: PrStack;
  /** The generation-time stack, when it differs from `stack`. */
  snapshot?: PrStack | undefined;
  /** ISO time `stack` was recorded, when it is the record rather than live. */
  asOf?: string | undefined;
  /** `stack` is the generation-time one, standing in for a closed PR. */
  atGeneration?: boolean | undefined;
  currentNumber: number;
  repoSlug: string;
  repoId?: string | undefined;
}

/**
 * The open panel's list and base bar. When the brief's stack differs, the bar
 * switches between the two, which share one cell so the bar never moves under
 * the pointer: a hover callout closes once the pointer is outside it. The
 * changed note sits outside that cell for the same reason.
 */
export function StackPanel({
  stack,
  snapshot,
  asOf,
  atGeneration,
  currentNumber,
  repoSlug,
  repoId,
}: StackPanelProps) {
  const { i18n, t } = useTranslation();
  const [version, setVersion] = useState<StackVersion>(StackVersions.NOW);

  const shown = resolveShownStack(stack, snapshot, version);
  const showingSnapshot = shown !== stack;
  const liveListLabel = atGeneration
    ? t("brief.header.stackAtGenerationAria")
    : t("brief.header.stackDisclosureAria");
  const showsBar = shown.baseRef !== undefined || snapshot !== undefined;
  const locale = renderedLocale(i18n.resolvedLanguage);
  const asOfLabel =
    asOf === undefined
      ? undefined
      : t("brief.header.stackAsOf", {
          date: formatDate(asOf, locale, { dateStyle: "medium" }),
        });
  const versionOptions: SegmentedOption<StackVersion>[] = [
    { value: StackVersions.NOW, label: t("brief.header.stackShowNow") },
    {
      value: StackVersions.AT_GENERATION,
      label: t("brief.header.stackShowAtGeneration"),
    },
  ];

  return (
    <>
      <span className={styles["versions"]}>
        <StackVersionCell active={!showingSnapshot}>
          {atGeneration ? (
            <span className={styles["leadIn"]}>
              {t("brief.header.stackAtGeneration")}
            </span>
          ) : null}
          <StackLists
            currentNumber={currentNumber}
            listLabel={liveListLabel}
            repoSlug={repoSlug}
            repoId={repoId}
            stack={stack}
          />
          {asOfLabel === undefined ? null : (
            <span className={styles["leadIn"]}>{asOfLabel}</span>
          )}
        </StackVersionCell>
        {snapshot === undefined ? null : (
          <StackVersionCell active={showingSnapshot}>
            <StackLists
              currentNumber={currentNumber}
              listLabel={t("brief.header.stackAtGenerationAria")}
              repoSlug={repoSlug}
              repoId={repoId}
              stack={snapshot}
            />
          </StackVersionCell>
        )}
      </span>
      {snapshot === undefined ? null : (
        <span className={styles["changed"]} data-testid="stack-changed">
          {t("brief.header.stackChanged")}
        </span>
      )}
      {showsBar ? (
        <StackBase baseRef={shown.baseRef}>
          {snapshot === undefined ? undefined : (
            <SegmentedControl
              legend={t("brief.header.stackChanged")}
              name="stack-version"
              onChange={setVersion}
              options={versionOptions}
              value={version}
            />
          )}
        </StackBase>
      ) : null}
    </>
  );
}
