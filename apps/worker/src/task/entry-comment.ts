// The Entry comment: ONE branded comment per PR, maintained by delete+repost
// per settled head; the deep link is navigation, never a compute trigger.
// Pure builders only; the delete+repost orchestration lives in `generate/logic/`.
// The body carries no secrets: a public deep link and public SHAs. The
// sentences come from the catalog; the Markdown around them is built here.
import type { TFunction } from "i18next";

const SHORT_SHA_LENGTH = 7;

export interface EntryCommentLink {
  /** The web deployment's public origin (`PUBLIC_BASE_URL`). */
  readonly publicBaseUrl: string;
  /** GitHub's immutable numeric repo id (the FE route key). */
  readonly repoId: bigint;
  readonly prNumber: number;
  /** The brief's index on this PR, the `rev` the web route addresses. */
  readonly headIndex: number;
  /** Named in the body's short sha, never in the link. */
  readonly headSha: string;
}

/** The revision deep link into the web app's DB-brief route. */
export function entryCommentDeepLink(link: EntryCommentLink): string {
  const origin = link.publicBaseUrl.replace(/\/+$/, "");
  return `${origin}/repos/${link.repoId}/pulls/${link.prNumber}?rev=${String(link.headIndex)}`;
}

/** The branded "ready" body posted once the brief artifact is readable. */
export function entryCommentBody(t: TFunction, link: EntryCommentLink): string {
  const deepLink = entryCommentDeepLink(link);
  const shortSha = formatShortSha(link.headSha);
  const heading = `**[${t("entryComment.ready.link")}](${deepLink})** (${shortSha})`;
  const footer = formatFooter(t("entryComment.ready.footer"));
  return [heading, "", footer].join("\n");
}

/** Where a capped PR's comment points: the PR view, no span (none exists). */
export interface EntryCommentPrLink {
  readonly publicBaseUrl: string;
  readonly repoId: bigint;
  readonly prNumber: number;
  /** The head that was skipped, named so the thread knows which push. */
  readonly headSha: string;
  /** When generation resumes, as an ISO instant (the next UTC midnight). */
  readonly resetsAt: Date;
}

/**
 * The capped body: this push got no brief because the instance hit its daily
 * generation cap. Used ONLY to UPDATE an Entry comment that already exists;
 * a capped PR never gets one created for it, so the cap can never make
 * MergeBrief louder on a thread than it already was. Spanless link: there is
 * no brief for this head to deep-link at.
 */
export function entryCommentCappedBody(
  t: TFunction,
  link: EntryCommentPrLink,
): string {
  const origin = link.publicBaseUrl.replace(/\/+$/, "");
  const url = `${origin}/repos/${link.repoId}/pulls/${link.prNumber}`;
  const shortSha = formatShortSha(link.headSha);
  const resetsAt = link.resetsAt.toISOString().replace(".000Z", "Z");
  const heading = `**${t("entryComment.capped.heading", { shortSha })}**`;
  const body = `${t("entryComment.capped.body", { resetsAt })} [${t("entryComment.capped.openLink")}](${url})`;
  const footer = formatFooter(t("entryComment.capped.footer"));
  return [heading, "", body, "", footer].join("\n");
}

/**
 * The "generating" body posted when a fresh generation starts. Same deep
 * link: the web app's diff-first wait UX renders the live diff immediately,
 * so the link is useful minutes before the Brief lands.
 */
export function entryCommentGeneratingBody(
  t: TFunction,
  link: EntryCommentLink,
): string {
  const deepLink = entryCommentDeepLink(link);
  const shortSha = formatShortSha(link.headSha);
  const heading = `**[${t("entryComment.generating.link")}](${deepLink})** (${shortSha})`;
  const footer = formatFooter(t("entryComment.generating.footer"));
  return [heading, "", footer].join("\n");
}

function formatShortSha(headSha: string): string {
  return `\`${headSha.slice(0, SHORT_SHA_LENGTH)}\``;
}

function formatFooter(footer: string): string {
  return `<sub>${footer}</sub>`;
}
