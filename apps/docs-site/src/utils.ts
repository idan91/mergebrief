import path from "node:path";
import type { Result } from "types";

const FRAGMENT_MARKER = "#";

export interface HrefParts {
  /** Decoded; empty for a same-page `#fragment` href. */
  path: string;
  /** Decoded; empty when the href has none. */
  fragment: string;
  /** The fragment as written, `#` included, for a rewritten href to carry unchanged; empty when the href has no `#`. */
  hash: string;
}

export function toPosixPath(file: string): string {
  return file.split(path.sep).join(path.posix.sep);
}

/** Splits an href at its first `#` and percent-decodes both parts; a malformed escape is a refusal, not a `URIError`. */
export function splitHref(href: string): Result<HrefParts, undefined> {
  const markerIndex = href.indexOf(FRAGMENT_MARKER);
  const hash = markerIndex === -1 ? "" : href.slice(markerIndex);
  const encodedPath = href.slice(0, href.length - hash.length);

  const targetPath = decodeHrefPart(encodedPath, decodeURI);
  if (!targetPath.ok) {
    return targetPath;
  }

  const fragment = decodeHrefPart(hash.slice(1), decodeURIComponent);
  if (!fragment.ok) {
    return fragment;
  }

  return {
    ok: true,
    value: { path: targetPath.value, fragment: fragment.value, hash },
  };
}

function decodeHrefPart(
  encoded: string,
  decode: (value: string) => string,
): Result<string, undefined> {
  try {
    return { ok: true, value: decode(encoded) };
  } catch {
    return { ok: false, error: undefined };
  }
}
