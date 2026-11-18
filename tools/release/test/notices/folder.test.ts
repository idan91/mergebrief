import { describe, expect, it } from "vitest";
import type { Result } from "types/utils";

import {
  buildNoticesFolder,
  checkNoticesVersion,
} from "../../src/logic/notices";
import {
  parseVersionsProperties,
  readSourceDownloads,
} from "../../src/logic/notices/build-script";
import type { FetchText } from "../../src/logic/notices/types";

const VERSIONS = parseVersionsProperties(
  [
    "VERSION_PROXY_LIBINTL=0.5",
    "VERSION_GLIB=2.90.0",
    "VERSION_FREETYPE=2.14.3",
    "VERSION_EXPAT=2.8.5",
    "VERSION_VIPS=8.18.7-rc1",
    "",
  ].join("\n"),
);

const BUILD_SCRIPT = [
  'CURL="curl --silent --location --retry 3"',
  "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
  "  $CURL https://github.com/frida/proxy-libintl/archive/${VERSION_PROXY_LIBINTL}.tar.gz | tar xzC ${DEPS}/proxy-libintl --strip-components=1",
  "$CURL https://download.gnome.org/sources/glib/$(without_patch $VERSION_GLIB)/glib-${VERSION_GLIB}.tar.xz | tar xJC ${DEPS}/glib --strip-components=1",
  "$CURL https://gist.github.com/k/1/raw/2/glib-without-gregex.patch | patch -p1",
  "  $CURL https://github.com/freetype/freetype/archive/VER-${VERSION_FREETYPE//./-}.tar.gz | tar xzC ${DEPS}/freetype --strip-components=1",
  "$CURL https://github.com/libexpat/libexpat/releases/download/R_${VERSION_EXPAT//./_}/expat-${VERSION_EXPAT}.tar.xz | tar xJC ${DEPS}/expat --strip-components=1",
  "$CURL https://github.com/libvips/libvips/releases/download/v${VERSION_VIPS}/vips-$(without_prerelease $VERSION_VIPS).tar.xz | tar xJC ${DEPS}/vips --strip-components=1",
  "$CURL -O https://raw.githubusercontent.com/lovell/sharp-libvips/main/THIRD-PARTY-NOTICES.md",
  "",
].join("\n");

const RELEASE = "https://raw.githubusercontent.com/lovell/sharp-libvips/v1.3.4";
const SPDX =
  "https://raw.githubusercontent.com/spdx/license-list-data/v3.29.0/text";

function stubFetch(files: Record<string, string>): FetchText {
  return async (url): Promise<Result<string, string>> => {
    const text = files[url];
    if (text === undefined) {
      return { ok: false, error: `${url} answered 404` };
    }
    return { ok: true, value: text };
  };
}

const RELEASE_FILES: Record<string, string> = {
  [`${RELEASE}/THIRD-PARTY-NOTICES.md`]:
    "# Third-party notices\n\n| libvips | LGPLv3 |\n",
  [`${RELEASE}/versions.properties`]: "VERSION_VIPS=8.18.7\n",
  [`${RELEASE}/build/posix.sh`]:
    "$CURL https://github.com/libvips/libvips/releases/download/v${VERSION_VIPS}/vips-${VERSION_VIPS}.tar.xz | tar xJC ${DEPS}/vips\n",
  [`${SPDX}/LGPL-3.0-only.txt`]: "GNU LESSER GENERAL PUBLIC LICENSE\n",
  [`${SPDX}/GPL-3.0-only.txt`]: "GNU GENERAL PUBLIC LICENSE\n",
  [`${SPDX}/MPL-1.1.txt`]: "Mozilla Public License Version 1.1\n",
  [`${SPDX}/EPL-2.0.txt`]: "Eclipse Public License - v 2.0\n",
};

async function readBuiltFile(
  fileName: string,
  elkjsVersion?: string,
): Promise<string | undefined> {
  const built = await buildNoticesFolder(
    stubFetch(RELEASE_FILES),
    "1.3.4",
    elkjsVersion,
  );
  const files = built.ok ? built.value : [];
  return files.find((file) => file.fileName === fileName)?.text;
}

describe("readSourceDownloads", () => {
  it("expands every download the build makes, patches under their library", () => {
    const downloads = readSourceDownloads(BUILD_SCRIPT, VERSIONS);

    expect(downloads).toEqual({
      ok: true,
      value: [
        {
          library: "proxy-libintl",
          version: "0.5",
          url: "https://github.com/frida/proxy-libintl/archive/0.5.tar.gz",
        },
        {
          library: "glib",
          version: "2.90.0",
          url: "https://download.gnome.org/sources/glib/2.90/glib-2.90.0.tar.xz",
        },
        {
          library: "glib",
          url: "https://gist.github.com/k/1/raw/2/glib-without-gregex.patch",
        },
        {
          library: "freetype",
          version: "2.14.3",
          url: "https://github.com/freetype/freetype/archive/VER-2-14-3.tar.gz",
        },
        {
          library: "expat",
          version: "2.8.5",
          url: "https://github.com/libexpat/libexpat/releases/download/R_2_8_5/expat-2.8.5.tar.xz",
        },
        {
          library: "vips",
          version: "8.18.7-rc1",
          url: "https://github.com/libvips/libvips/releases/download/v8.18.7-rc1/vips-8.18.7.tar.xz",
        },
      ],
    });
  });

  it("refuses a download naming a version the release does not list", () => {
    const script =
      "$CURL https://x.example/a-${VERSION_NOPE}.tar.gz | tar xzC ${DEPS}/a";

    const downloads = readSourceDownloads(script, VERSIONS);

    expect(!downloads.ok && downloads.error).toMatch(/VERSION_NOPE/);
  });

  it("refuses a download whose shell it cannot expand", () => {
    const script =
      "$CURL https://x.example/$(date)/a.tar.gz | tar xzC ${DEPS}/a";

    const downloads = readSourceDownloads(script, VERSIONS);

    expect(!downloads.ok && downloads.error).toMatch(/cannot expand/);
  });

  it("refuses a patch that follows no library", () => {
    const script = "$CURL https://x.example/fix.patch | patch -p1\n";

    expect(readSourceDownloads(script, VERSIONS).ok).toBe(false);
  });
});

describe("buildNoticesFolder", () => {
  it("writes the notices, the three licence texts and the sources", async () => {
    const built = await buildNoticesFolder(stubFetch(RELEASE_FILES), "1.3.4");

    expect(built.ok).toBe(true);
    const files = built.ok ? built.value : [];
    expect(files.map((file) => file.fileName)).toEqual([
      "GPL-3.0.txt",
      "LGPL-3.0.txt",
      "MPL-1.1.txt",
      "SOURCES.md",
      "THIRD-PARTY-NOTICES.md",
    ]);
    const notices = files.find(
      (file) => file.fileName === "THIRD-PARTY-NOTICES.md",
    );
    expect(notices?.text).toBe(
      RELEASE_FILES[`${RELEASE}/THIRD-PARTY-NOTICES.md`],
    );
  });

  it("records the version and each source link in SOURCES.md", async () => {
    const built = await buildNoticesFolder(stubFetch(RELEASE_FILES), "1.3.4");

    const files = built.ok ? built.value : [];
    const sources = files.find((file) => file.fileName === "SOURCES.md")?.text;
    expect(sources).toContain(
      "| vips | 8.18.7 | https://github.com/libvips/libvips/releases/download/v8.18.7/vips-8.18.7.tar.xz |",
    );
    expect(sources).toContain(
      "https://github.com/lovell/sharp-libvips/tree/v1.3.4",
    );
    const lockfile = "packages:\n  '@img/sharp-libvips-linux-x64@1.3.4':\n";
    expect(checkNoticesVersion(lockfile, sources)).toEqual({
      ok: true,
      value: { libvips: "1.3.4" },
    });
  });

  it("adds the EPL-2.0 text when elkjs ships", async () => {
    const built = await buildNoticesFolder(
      stubFetch(RELEASE_FILES),
      "1.3.4",
      "0.9.3",
    );

    const files = built.ok ? built.value : [];
    expect(files.map((file) => file.fileName)).toEqual([
      "EPL-2.0.txt",
      "GPL-3.0.txt",
      "LGPL-3.0.txt",
      "MPL-1.1.txt",
      "SOURCES.md",
      "THIRD-PARTY-NOTICES.md",
    ]);
    expect(files[0]?.text).toBe(RELEASE_FILES[`${SPDX}/EPL-2.0.txt`]);
  });

  it("records elkjs's version and tag archive in SOURCES.md", async () => {
    const sources = await readBuiltFile("SOURCES.md", "0.9.3");

    expect(sources).toContain(
      "https://github.com/kieler/elkjs/archive/refs/tags/0.9.3.tar.gz",
    );
    expect(sources).toContain("https://github.com/eclipse/elk");
    const lockfile =
      "packages:\n  '@img/sharp-libvips-linux-x64@1.3.4':\n  elkjs@0.9.3:\n";
    expect(checkNoticesVersion(lockfile, sources)).toEqual({
      ok: true,
      value: { libvips: "1.3.4", elkjs: "0.9.3" },
    });
  });

  it("names elkjs, its licence and its source under the libvips notices", async () => {
    const notices = await readBuiltFile("THIRD-PARTY-NOTICES.md", "0.9.3");

    const upstream = RELEASE_FILES[`${RELEASE}/THIRD-PARTY-NOTICES.md`] ?? "";
    expect(notices?.startsWith(upstream)).toBe(true);
    expect(notices).toMatch(/elkjs 0\.9\.3.*Eclipse Public License 2\.0/);
    expect(notices).toContain("EPL-2.0.txt");
    expect(notices).toContain("https://github.com/kieler/elkjs/tree/0.9.3");
  });

  it("names no elkjs when it does not ship", async () => {
    const sources = await readBuiltFile("SOURCES.md");

    expect(sources).not.toContain("elkjs");
  });

  it("fails when a release file does not answer", async () => {
    const files = { ...RELEASE_FILES };
    delete files[`${SPDX}/MPL-1.1.txt`];

    const built = await buildNoticesFolder(stubFetch(files), "1.3.4");

    expect(!built.ok && built.error).toMatch(/MPL-1\.1\.txt answered 404/);
  });
});
