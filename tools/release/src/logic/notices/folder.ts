import type { Result } from "types/utils";

import { parseVersionsProperties, readSourceDownloads } from "./build-script";
import {
  ELKJS_LICENSE_TEXT,
  GITHUB_RAW_ORIGIN,
  LICENSE_TEXTS,
  SHARP_LIBVIPS_RELEASE_FILES,
  SHARP_LIBVIPS_REPOSITORY,
  SOURCES_FILE,
  SPDX_LICENSE_DATA_REPOSITORY,
  SPDX_LICENSE_DATA_TAG,
  THIRD_PARTY_NOTICES_FILE,
} from "./consts";
import { renderElkjsNotice } from "./elkjs";
import { renderSourcesFile } from "./sources-file";
import type { FetchText, NoticeFile } from "./types";

async function fetchAll(
  fetchText: FetchText,
  urls: readonly string[],
): Promise<Result<string[], string>> {
  const answers = await Promise.all(urls.map((url) => fetchText(url)));
  const texts: string[] = [];
  for (const answer of answers) {
    if (!answer.ok) {
      return answer;
    }
    texts.push(answer.value);
  }
  return { ok: true, value: texts };
}

/**
 * The notices folder for one sharp-libvips release, read from that release's
 * tag: its third-party notices verbatim, the LGPL-3.0, GPL-3.0 and MPL-1.1
 * texts, and `SOURCES.md`. When elkjs ships, the notices gain its line, the
 * folder the EPL-2.0 text and `SOURCES.md` its section. Sorted by file name;
 * nothing is written here.
 */
export async function buildNoticesFolder(
  fetchText: FetchText,
  version: string,
  elkjsVersion?: string,
): Promise<Result<NoticeFile[], string>> {
  const release = `${GITHUB_RAW_ORIGIN}/${SHARP_LIBVIPS_REPOSITORY}/v${version}`;
  const spdx = `${GITHUB_RAW_ORIGIN}/${SPDX_LICENSE_DATA_REPOSITORY}/${SPDX_LICENSE_DATA_TAG}/text`;
  const releaseFiles = Object.values(SHARP_LIBVIPS_RELEASE_FILES);
  const licenseTextsShipped =
    elkjsVersion === undefined
      ? LICENSE_TEXTS
      : [...LICENSE_TEXTS, ELKJS_LICENSE_TEXT];
  const fetched = await fetchAll(fetchText, [
    ...releaseFiles.map((path) => `${release}/${path}`),
    ...licenseTextsShipped.map((text) => `${spdx}/${text.spdxId}.txt`),
  ]);
  if (!fetched.ok) {
    return fetched;
  }

  const [notices = "", versionsText = "", buildScript = "", ...licenseTexts] =
    fetched.value;
  const downloads = readSourceDownloads(
    buildScript,
    parseVersionsProperties(versionsText),
  );
  if (!downloads.ok) {
    return downloads;
  }

  const elkjsNotice =
    elkjsVersion === undefined ? "" : renderElkjsNotice(elkjsVersion);
  const files: NoticeFile[] = [
    { fileName: THIRD_PARTY_NOTICES_FILE, text: `${notices}${elkjsNotice}` },
    {
      fileName: SOURCES_FILE,
      text: renderSourcesFile(version, downloads.value, elkjsVersion),
    },
    ...licenseTextsShipped.map((text, index) => ({
      fileName: text.fileName,
      text: licenseTexts[index] ?? "",
    })),
  ];
  return {
    ok: true,
    value: files.toSorted((left, right) =>
      left.fileName.localeCompare(right.fileName),
    ),
  };
}
