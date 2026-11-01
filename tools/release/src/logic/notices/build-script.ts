// The source links come from the release's own build script, the downloads
// it made with the versions it pinned, so a library added, moved or patched
// in a new release shows up here rather than being kept by hand. The script
// is read, never run: each `$CURL <url>` line is expanded in the five shell
// forms the script uses, and any other shell in a URL refuses.
import type { Mutable, Result } from "types/utils";

import type { SourceDownload } from "./types";

type VersionTransform = (version: string) => string;

const DOWNLOAD_LINE = /^\s*\$CURL (https:\/\/.+?)(\s+\|.*)?$/;
const ARCHIVE_TARGET = /\$\{DEPS\}\/([\w.-]+)/;
const PATCH_SUFFIX = ".patch";
const VERSION_NAME = /VERSION_[A-Z0-9_]+/;
const PROPERTY_LINE = /^(VERSION_[A-Z0-9_]+)=(.+)$/;

/** bash `${1%.[[:digit:]]*}`: the version up to its last dot that a digit follows. */
function dropPatchComponent(version: string): string {
  const match = /\.\d[^.]*$/.exec(version);
  return match === null ? version : version.slice(0, match.index);
}

/** bash `${1%-[[:alnum:]]*}`: the version up to its last dash that a letter or digit follows. */
function dropPrerelease(version: string): string {
  const match = /-[A-Za-z0-9][^-]*$/.exec(version);
  return match === null ? version : version.slice(0, match.index);
}

const EXPANSIONS: readonly (readonly [RegExp, VersionTransform])[] = [
  [
    /\$\{(VERSION_[A-Z0-9_]+)\/\/\.\/-\}/g,
    (version) => version.replaceAll(".", "-"),
  ],
  [
    /\$\{(VERSION_[A-Z0-9_]+)\/\/\.\/_\}/g,
    (version) => version.replaceAll(".", "_"),
  ],
  [/\$\(without_patch \$(VERSION_[A-Z0-9_]+)\)/g, dropPatchComponent],
  [/\$\(without_prerelease \$(VERSION_[A-Z0-9_]+)\)/g, dropPrerelease],
  [/\$\{(VERSION_[A-Z0-9_]+)\}/g, (version) => version],
];

/** `VERSION_X=value` lines, as the release pins them; `versions.json` is written from these. */
export function parseVersionsProperties(text: string): Map<string, string> {
  const versions = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [, name, value] = PROPERTY_LINE.exec(line.trim()) ?? [];
    if (name !== undefined && value !== undefined) {
      versions.set(name, value);
    }
  }
  return versions;
}

function expandUrl(
  template: string,
  versions: ReadonlyMap<string, string>,
): Result<string, string> {
  let url = template;
  for (const [pattern, transform] of EXPANSIONS) {
    let unknown: string | undefined;
    url = url.replaceAll(pattern, (_whole, name: string) => {
      const version = versions.get(name);
      if (version === undefined) {
        unknown = name;
        return "";
      }
      return transform(version);
    });
    if (unknown !== undefined) {
      return {
        ok: false,
        error: `${template} names ${unknown}, which the release does not pin`,
      };
    }
  }
  if (url.includes("$")) {
    return { ok: false, error: `cannot expand the shell in ${template}` };
  }
  return { ok: true, value: url };
}

function readDownload(
  line: string,
  versions: ReadonlyMap<string, string>,
  library: string | undefined,
): Result<SourceDownload, string> {
  const [, template = "", rest = ""] = DOWNLOAD_LINE.exec(line) ?? [];
  const url = expandUrl(template, versions);
  if (!url.ok) {
    return url;
  }
  if (url.value.endsWith(PATCH_SUFFIX)) {
    if (library === undefined) {
      return { ok: false, error: `${url.value} patches no library` };
    }
    return { ok: true, value: { library, url: url.value } };
  }

  const [, target] = ARCHIVE_TARGET.exec(rest) ?? [];
  if (target === undefined) {
    return { ok: false, error: `${url.value} unpacks into no library folder` };
  }
  const download: Mutable<SourceDownload> = {
    library: target,
    url: url.value,
  };
  const [versionName] = VERSION_NAME.exec(template) ?? [];
  const version =
    versionName === undefined ? undefined : versions.get(versionName);
  if (version !== undefined) {
    download.version = version;
  }
  return { ok: true, value: download };
}

/** Every archive and patch the build script downloads, in its order; a patch belongs to the archive before it. */
export function readSourceDownloads(
  buildScript: string,
  versions: ReadonlyMap<string, string>,
): Result<SourceDownload[], string> {
  const downloads: SourceDownload[] = [];
  let library: string | undefined;
  for (const line of buildScript.split("\n")) {
    if (!DOWNLOAD_LINE.test(line)) {
      continue;
    }
    const download = readDownload(line, versions, library);
    if (!download.ok) {
      return download;
    }
    downloads.push(download.value);
    library = download.value.library;
  }
  return { ok: true, value: downloads };
}
