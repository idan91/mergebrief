import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { Disposition } from "@web/features/review/session";
import { Button } from "@web/components/Button";
import { LinkButton } from "@web/components/LinkButton";
import type { RiskFlag } from "../../../../../../../model/utils/view-model";
import { pickPathJumpChunkId, type FileFlagRow } from "../utils";
import { ResolvedFlagItem } from "./ResolvedFlagItem";
import styles from "./ResolvedFold.module.scss";

export interface ResolvedFoldProps {
  rows: FileFlagRow[];
  dispositions: Record<string, Disposition | undefined>;
  flagsReadOnly: boolean;
  jumpToChunk: (chunkId: string) => void;
  reopenFlag: (flag: RiskFlag) => void;
}

export function ResolvedFold({
  rows,
  dispositions,
  flagsReadOnly,
  jumpToChunk,
  reopenFlag,
}: ResolvedFoldProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className={styles["fold"]}>
      <Button
        aria-expanded={open}
        size="sm"
        variant="quiet"
        onClick={() => setOpen((current) => !current)}
      >
        {t("brief.group.resolved", { count: rows.length })}
      </Button>
      {open ? (
        <ul className={styles["resolvedList"]}>
          {rows.map((row) => (
            <li className={styles["resolvedFile"]} key={row.file}>
              <LinkButton
                className={styles["path"]}
                title={row.file}
                onClick={() => jumpToChunk(pickPathJumpChunkId(row))}
              >
                <bdi dir="ltr">{row.file}</bdi>
              </LinkButton>
              <div className={styles["resolvedMeta"]}>
                {row.flags.map((flag) => (
                  <ResolvedFlagItem
                    dispositions={dispositions}
                    flag={flag}
                    flagsReadOnly={flagsReadOnly}
                    key={flag.id}
                    reopenFlag={reopenFlag}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
