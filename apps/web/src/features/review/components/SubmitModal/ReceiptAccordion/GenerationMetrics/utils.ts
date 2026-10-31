import type { TFunction } from "i18next";
import { ShortenedReadings } from "brief-core/types";

import type { ReceiptShortenedFile } from "../../../../utils/receipt";

const SHORTENED_PARTS_JOINER = " · ";

/**
 * One phrase per read-as kind with a file, joined, so a count of zero prints
 * nothing; undefined when no file was shortened.
 */
export function formatShortenedLine(
  t: TFunction,
  shortened: readonly ReceiptShortenedFile[],
): string | undefined {
  const packageFiles = shortened.filter(
    (entry) => entry.readAs === ShortenedReadings.PACKAGE_SUMMARY,
  ).length;
  const countFiles = shortened.length - packageFiles;

  const parts: string[] = [];
  if (packageFiles > 0) {
    parts.push(
      t("review.summary.shortenedFilesPackages", { count: packageFiles }),
    );
  }
  if (countFiles > 0) {
    parts.push(t("review.summary.shortenedFilesCounts", { count: countFiles }));
  }

  return parts.length > 0 ? parts.join(SHORTENED_PARTS_JOINER) : undefined;
}
