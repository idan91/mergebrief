import { useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  Disposition,
  ReviewFlowActions,
} from "@web/features/review/session";
import { LinkButton } from "@web/components/LinkButton";
import { RiskBadge } from "../../../../RiskBadge";
import { RiskChipDisclosure } from "../../../../RiskChipDisclosure";
import {
  getRiskAttributeInlineLabel,
  getRiskAttributeLabel,
  type RiskFlag,
} from "../../../../../../../model/utils/view-model";
import { CatalogChipDetail } from "../CatalogChipDetail";
import {
  capitalizeSentence,
  getFlagDispositionKind,
  pickPathJumpChunkId,
  type FileFlagRow,
} from "../utils";
import styles from "./FileRow.module.scss";
import { Icon } from "@web/components/Icon";
import {
  IconNames,
  IconRotations,
  IconSizes,
} from "@web/components/Icon/types";

export interface FileRowProps {
  row: FileFlagRow;
  /** The reader is in this file. */
  current: boolean;
  flagsReadOnly: boolean;
  selectedFlagSet: Set<string>;
  dispositions: Record<string, Disposition | undefined>;
  jumpToChunk: (chunkId: string) => void;
  reopenFlag: (flag: RiskFlag) => void;
  toggleRiskGroup: ReviewFlowActions["toggleRiskGroup"];
}

export function FileRow({
  row,
  current,
  flagsReadOnly,
  selectedFlagSet,
  dispositions,
  jumpToChunk,
  reopenFlag,
  toggleRiskGroup,
}: FileRowProps) {
  const { t } = useTranslation();
  const [notesOpen, setNotesOpen] = useState(false);
  const openIds = row.openFlags.map((flag) => flag.id);
  const selectedCount = openIds.filter((flagId) =>
    selectedFlagSet.has(flagId),
  ).length;
  const allSelected = openIds.length > 0 && selectedCount === openIds.length;
  const notes = row.flags.filter((flag) => flag.note !== undefined);
  const mixed = row.resolvedFlags.length > 0 && row.openFlags.length > 0;
  const jumpChunkId = pickPathJumpChunkId(row);
  const flagChips = row.flags.map((flag) => {
    const kind = getFlagDispositionKind(dispositions, flag.id);
    const dim = mixed && kind !== "open";
    const showReopen = kind === "dismissed" && !flagsReadOnly;
    const reopenLabel = t("brief.group.ariaLabelReopen", {
      attr: getRiskAttributeInlineLabel(t, flag.attr),
      file: flag.file,
    });
    return { flag, dim, showReopen, reopenLabel };
  });
  const noteRows = notes.map((flag) => {
    const sentence =
      flag.note === undefined ? undefined : capitalizeSentence(flag.note);
    const attributeLabel = getRiskAttributeLabel(t, flag.attr);
    return { flag, sentence, attributeLabel };
  });

  return (
    <li
      aria-current={current ? "true" : undefined}
      className={styles["file"]}
      data-notes-open={notesOpen ? "" : undefined}
      data-state={current ? "current" : undefined}
    >
      {flagsReadOnly ? (
        <span aria-hidden="true" className={styles["check"]} />
      ) : (
        <label className={styles["check"]}>
          <input
            aria-label={t("brief.group.selectFile", { file: row.file })}
            checked={allSelected}
            disabled={openIds.length === 0}
            suppressHydrationWarning
            type="checkbox"
            onChange={() => toggleRiskGroup(openIds)}
          />
        </label>
      )}
      <div className={styles["identity"]}>
        <LinkButton
          className={styles["path"]}
          title={row.file}
          onClick={() => jumpToChunk(jumpChunkId)}
        >
          {row.file}
        </LinkButton>
      </div>
      <div className={styles["chipsRow"]}>
        {notes.length > 0 ? (
          // oxlint-disable-next-line house/no-raw-button -- notes disclosure twist, not a product Button
          <button
            aria-expanded={notesOpen}
            aria-label={t("brief.group.notesToggle")}
            className={styles["notesToggle"]}
            type="button"
            onClick={() => setNotesOpen((open) => !open)}
          >
            <Icon
              className={styles["twist"]}
              name={IconNames.CARET_DOWN}
              rotation={
                notesOpen ? IconRotations.NONE : IconRotations.THREE_QUARTERS
              }
              size={IconSizes.SM}
            />
          </button>
        ) : (
          <span aria-hidden="true" className={styles["twistSlot"]} />
        )}
        <div className={styles["chips"]}>
          {flagChips.map(({ flag, dim, showReopen, reopenLabel }) => (
            <span className={styles["chipItem"]} key={flag.id}>
              <span data-resolved={dim ? "" : undefined}>
                <RiskChipDisclosure detail={<CatalogChipDetail flag={flag} />}>
                  <RiskBadge
                    attribute={flag.attr}
                    meta={{
                      source: flag.source,
                      deEmphasized: flag.deEmphasized,
                    }}
                  />
                </RiskChipDisclosure>
              </span>
              {showReopen ? (
                <LinkButton
                  aria-label={reopenLabel}
                  className={styles["reopen"]}
                  onClick={() => reopenFlag(flag)}
                >
                  {t("brief.group.reopen")}
                </LinkButton>
              ) : null}
            </span>
          ))}
        </div>
      </div>
      {notesOpen ? (
        <ul className={styles["notes"]}>
          {noteRows.map(({ flag, sentence, attributeLabel }) => (
            <li key={flag.id}>
              <span className={styles["noteAttr"]}>{attributeLabel}</span>
              {sentence}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}
