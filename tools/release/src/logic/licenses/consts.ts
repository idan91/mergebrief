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
];
