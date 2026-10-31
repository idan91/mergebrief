import { useTranslation } from "react-i18next";
import type { TranslationKey } from "i18n";
import { ShortenedReadings, type ShortenedReading } from "brief-core/types";

import { Badge } from "@web/components/Badge";

export interface ReadAsBadgeProps {
  readAs: ShortenedReading;
}

const LABEL_KEYS: Record<ShortenedReading, TranslationKey> = {
  [ShortenedReadings.PACKAGE_SUMMARY]: "brief.chunk.readAsPackageChanges",
  [ShortenedReadings.COUNTS_ONLY]: "brief.chunk.readAsCountsOnly",
};

/** A multi-call run showed the model this file's facts, not its code: a chip in the header's own family. */
export function ReadAsBadge({ readAs }: ReadAsBadgeProps) {
  const { t } = useTranslation();

  return <Badge dataset={{ "read-as": readAs }}>{t(LABEL_KEYS[readAs])}</Badge>;
}
