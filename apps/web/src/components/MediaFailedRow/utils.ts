import { GITHUB_HOST, RAW_CONTENT_HOST } from "brief-core/media-address";
import type { TFunction } from "i18next";
import type { Result } from "types/utils";

import {
  ELLIPSIS,
  FAILED_WORDING_KEYS,
  OUTSIDE_ALT_MAX_CHARS,
  OUTSIDE_ALT_WORD_SLACK,
} from "./consts";

import {
  MediaFailedRowStates,
  type MediaFailedRowContent,
  type MediaFailedRowInput,
  type MediaFailedRowLink,
} from "./types";

/** Spaces and the punctuation a cut would leave hanging before the ellipsis. */
const TRAILING_BREAK = /[\s,;:.]+$/;

const HTTPS_PROTOCOL = "https:";
const GITHUB_LINK_HOSTS: ReadonlySet<string> = new Set([
  GITHUB_HOST,
  RAW_CONTENT_HOST,
]);

function parseAddress(address: string): Result<URL, undefined> {
  try {
    return { ok: true, value: new URL(address) };
  } catch {
    return { ok: false, error: undefined };
  }
}

/**
 * The original address as a link, only when it is an https address on a
 * GitHub host with nothing beyond host and path a reader would miss: an
 * outside host never gets an "Open on GitHub" link.
 */
export function buildGitHubOriginalLink(address: string): string | undefined {
  const parsed = parseAddress(address);
  if (!parsed.ok || parsed.value.protocol !== HTTPS_PROTOCOL) {
    return undefined;
  }
  const url = parsed.value;
  const hasCredentials = url.username !== "" || url.password !== "";
  const isGitHubHost = GITHUB_LINK_HOSTS.has(url.hostname);
  if (hasCredentials || url.port !== "" || !isGitHubHost) {
    return undefined;
  }

  return url.href;
}

function buildLink(
  href: string | undefined,
  label: string,
): MediaFailedRowLink | undefined {
  return href === undefined ? undefined : { href, label };
}

/** An outside row wraps as text and clamps no line, so the alt text is cut by length. */
function cutOutsideAlt(alt: string): string {
  if (alt.length <= OUTSIDE_ALT_MAX_CHARS) {
    return alt;
  }
  const cut = alt.slice(0, OUTSIDE_ALT_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  const endsOnWord =
    lastSpace >= OUTSIDE_ALT_MAX_CHARS - OUTSIDE_ALT_WORD_SLACK;
  const kept = endsOnWord ? cut.slice(0, lastSpace) : cut;
  return `${kept.replace(TRAILING_BREAK, "")}${ELLIPSIS}`;
}

function describeOutsideRow(
  t: TFunction,
  input: MediaFailedRowInput,
  host: string,
): MediaFailedRowContent {
  const alt = cutOutsideAlt(input.alt?.trim() ?? "");
  const wording =
    alt === ""
      ? t("shell.media.imageOutside", { host })
      : t("shell.media.imageOutsideNamed", { alt, host });

  return {
    state: MediaFailedRowStates.OUTSIDE,
    wording,
    iconLabel: undefined,
    link: buildLink(input.originalAddress, t("shell.media.openOutside")),
  };
}

/** The row's wording and link: an outside image names its host, a failure reads the alt text. */
export function describeRow(
  t: TFunction,
  input: MediaFailedRowInput,
): MediaFailedRowContent {
  if (input.outsideHost !== undefined) {
    return describeOutsideRow(t, input, input.outsideHost);
  }

  const authorText = input.alt?.trim() ?? "";
  const failedWording = t(FAILED_WORDING_KEYS[input.kind]);
  const hasAuthorText = authorText !== "";
  const githubLink =
    input.originalAddress === undefined
      ? undefined
      : buildGitHubOriginalLink(input.originalAddress);

  return {
    state: MediaFailedRowStates.FAILED,
    wording: hasAuthorText ? authorText : failedWording,
    iconLabel: hasAuthorText ? failedWording : undefined,
    link: buildLink(githubLink, t("shell.media.openOnGithub")),
  };
}
