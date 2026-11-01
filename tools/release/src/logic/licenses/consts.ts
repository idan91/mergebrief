import type { LicenseException } from "./types";

/** SPDX ids the public tree may ship under FSL-1.1-ALv2; anything else fails unless excepted by name. */
export const ALLOWED_LICENSES: ReadonlySet<string> = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Apache-2.0",
  "0BSD",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "Unlicense",
  "Python-2.0",
  "CC-BY-4.0",
  "MPL-2.0",
]);

const FONT_EXCEPTION_REASON =
  "OFL-1.1 font files may be bundled and redistributed with software; only selling the fonts on their own is barred";

export const LICENSE_EXCEPTIONS: readonly LicenseException[] = [
  {
    name: "@fontsource/ibm-plex-mono",
    license: "OFL-1.1",
    reason: FONT_EXCEPTION_REASON,
  },
  {
    name: "@fontsource/ibm-plex-sans",
    license: "OFL-1.1",
    reason: FONT_EXCEPTION_REASON,
  },
  {
    name: "elkjs",
    license: "EPL-2.0",
    reason:
      "Mermaid's ELK layout, shipped unmodified in its own lazy web chunk that a browser fetches only for a diagram asking for the ELK layout (ours default to dagre); EPL-2.0 is file-level copyleft like the allowed MPL-2.0, and the image's THIRD_PARTY_NOTICES folder carries the EPL-2.0 text and the source link at the locked version",
  },
  {
    name: "@img/sharp-libvips-*",
    license: "LGPL-3.0-or-later",
    reason:
      "sharp's prebuilt libvips, one package per platform: LGPL-3.0 shipped unmodified as separate shared objects a user can replace, and the image's THIRD_PARTY_NOTICES folder carries the licence texts and the source offer",
  },
  {
    name: "khroma",
    license: "Unknown",
    reason:
      "Mermaid's colour library; its manifest omits the license field, and the license file it ships is MIT",
  },
];
