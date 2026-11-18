import type { TFunction } from "i18next";
import type { TranslationKey } from "i18n";
import { ShortenedReadings, type ShortenedReading } from "brief-core/types";

import type { ReceiptShortenedFile } from "../../../../utils/receipt";

const SHORTENED_PARTS_JOINER = " · ";

const SHORTENED_LINE_KEYS: Record<ShortenedReading, TranslationKey> = {
  [ShortenedReadings.PACKAGE_SUMMARY]: "review.summary.shortenedFilesPackages",
  [ShortenedReadings.COUNTS_ONLY]: "review.summary.shortenedFilesCounts",
};

/**
 * One phrase per read-as kind with a file, joined, so a count of zero prints
 * nothing; undefined when no file was shortened.
 */
export function formatShortenedLine(
  t: TFunction,
  shortened: readonly ReceiptShortenedFile[],
): string | undefined {
  const parts: string[] = [];
  for (const readAs of Object.values(ShortenedReadings)) {
    const count = shortened.filter((entry) => entry.readAs === readAs).length;
    if (count > 0) {
      parts.push(t(SHORTENED_LINE_KEYS[readAs], { count }));
    }
  }

  return parts.length > 0 ? parts.join(SHORTENED_PARTS_JOINER) : undefined;
}
