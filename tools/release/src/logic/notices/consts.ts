/** Where the image's third-party notices live in the repository; the Dockerfile copies the folder. */
export const NOTICES_DIR = "docker/third-party-notices";
export const SOURCES_FILE = "SOURCES.md";
export const THIRD_PARTY_NOTICES_FILE = "THIRD-PARTY-NOTICES.md";

/** Every platform build of sharp's libvips is one package under this prefix, all at one version. */
export const LIBVIPS_PACKAGE_PREFIX = "@img/sharp-libvips-";
export const SHARP_LIBVIPS_REPOSITORY = "lovell/sharp-libvips";
export const GITHUB_RAW_ORIGIN = "https://raw.githubusercontent.com";
export const GITHUB_ORIGIN = "https://github.com";
/** The release's own files, read at its tag. */
export const SHARP_LIBVIPS_RELEASE_FILES = {
  NOTICES: "THIRD-PARTY-NOTICES.md",
  VERSIONS: "versions.properties",
  BUILD_SCRIPT: "build/posix.sh",
} as const;

/** The licence texts the notices name, from the SPDX licence list at a pinned tag. */
export const SPDX_LICENSE_DATA_REPOSITORY = "spdx/license-list-data";
export const SPDX_LICENSE_DATA_TAG = "v3.29.0";
export const LICENSE_TEXTS = [
  { spdxId: "LGPL-3.0-only", fileName: "LGPL-3.0.txt" },
  { spdxId: "GPL-3.0-only", fileName: "GPL-3.0.txt" },
  { spdxId: "MPL-1.1", fileName: "MPL-1.1.txt" },
] as const;

/** Mermaid's graph layout, EPL-2.0, minified unmodified into a web chunk; GWT output of the ELK Java source. */
export const ELKJS_PACKAGE = "elkjs";
export const ELKJS_REPOSITORY = "kieler/elkjs";
export const ELK_REPOSITORY = "eclipse/elk";
export const ELKJS_LICENSE_TEXT = {
  spdxId: "EPL-2.0",
  fileName: "EPL-2.0.txt",
} as const;

/** The lines in `SOURCES.md` the version check reads. */
export const RECORDED_LIBVIPS_VERSION_LABEL = "sharp-libvips version:";
export const RECORDED_ELKJS_VERSION_LABEL = "elkjs version:";
export const REGENERATE_COMMAND = "pnpm -C tools/release notices";
