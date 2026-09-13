import { useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  Disposition,
  ReviewFlowActions,
} from "@web/features/review/session";
import { LinkButton } from "@web/components/LinkButton/LinkButton";
import { RiskBadge } from "../../../../../RiskBadge/RiskBadge";
import { RiskChipDisclosure } from "../../../../../RiskChipDisclosure/RiskChipDisclosure";
import type { RiskFlag } from "../../../../../../../utils/viewModel";
import { CatalogChipDetail } from "../CatalogChipDetail/CatalogChipDetail";
import {
  capitalizeSentence,
  getFlagDispositionKind,
  pickPathJumpChunkId,
  type FileFlagRow,
} from "../utils";
import styles from "./FileRow.module.scss";
import TwistIcon from "./twist.svg?react";

export interface FileRowProps {
  row: FileFlagRow;
  flagsReadOnly: boolean;
  selectedFlagSet: Set<string>;
  dispositions: Record<string, Disposition | undefined>;
  jumpToChunk: (chunkId: string) => void;
  reopenFlag: (flag: RiskFlag) => void;
  toggleRiskGroup: ReviewFlowActions["toggleRiskGroup"];
}

export function FileRow({
  row,
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

  return (
    <li className={styles["file"]} data-notes-open={notesOpen ? "" : undefined}>
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
            <TwistIcon aria-hidden="true" className={styles["twist"]} />
          </button>
        ) : (
          <span aria-hidden="true" className={styles["twistSlot"]} />
        )}
        <div className={styles["chips"]}>
          {row.flags.map((flag) => {
            const kind = getFlagDispositionKind(dispositions, flag.id);
            const dim = mixed && kind !== "open";
            const showReopen = kind === "dismissed" && !flagsReadOnly;
            return (
              <span className={styles["chipItem"]} key={flag.id}>
                <span data-resolved={dim ? "" : undefined}>
                  <RiskChipDisclosure
                    detail={<CatalogChipDetail flag={flag} />}
                  >
                    <RiskBadge
                      meta={{
                        source: flag.source,
                        deEmphasized: flag.deEmphasized,
                      }}
                    >
                      {flag.attr}
                    </RiskBadge>
                  </RiskChipDisclosure>
                </span>
                {showReopen ? (
                  <LinkButton
                    aria-label={t("brief.group.ariaLabelReopen", {
                      attr: flag.attr,
                      file: flag.file,
                    })}
                    className={styles["reopen"]}
                    onClick={() => reopenFlag(flag)}
                  >
                    {t("brief.group.reopen")}
                  </LinkButton>
                ) : null}
              </span>
            );
          })}
        </div>
      </div>
      {notesOpen ? (
        <ul className={styles["notes"]}>
          {notes.map((flag) => {
            const note = flag.note;
            const sentence =
              note === undefined ? undefined : capitalizeSentence(note);
            return (
              <li key={flag.id}>
                <span className={styles["noteAttr"]}>{flag.attr}</span>
                {sentence}
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
