import { useTranslation } from "react-i18next";
import type { TranslationKey } from "i18n";

import { Badge, BadgeColors } from "@web/components/Badge/Badge";
import { FileStatuses, type FileStatus } from "../../../../../types";

export interface FileStatusBadgeProps {
  status: FileStatus;
}

const LABEL_KEYS: Record<FileStatus, TranslationKey> = {
  [FileStatuses.NEW]: "brief.chunk.fileNew",
  [FileStatuses.DELETED]: "brief.chunk.fileDeleted",
};

/** The file is new to, or gone from, the tree: a chip in the header's own family. */
export function FileStatusBadge({ status }: FileStatusBadgeProps) {
  const { t } = useTranslation();
  const color =
    status === FileStatuses.NEW ? BadgeColors.POSITIVE : BadgeColors.NEGATIVE;

  return (
    <Badge color={color} dataset={{ status }}>
      {t(LABEL_KEYS[status])}
    </Badge>
  );
}
