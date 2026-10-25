// The Entry comment: ONE branded comment per PR, maintained by delete+repost
// per settled head; the deep link is navigation, never a compute trigger.
// Pure builders only; the delete+repost orchestration lives in `generate/logic/`.
// The body carries no secrets: a public deep link and public SHAs. The
// sentences come from the catalog; the Markdown around them is built here.
import type { TFunction } from "i18next";
import {
  GenerationFailureClassByCode,
  GenerationFailureClasses,
  GenerationFailureCodes,
  type GenerationFailureCode,
} from "types/generations";

const SHORT_SHA_LENGTH = 7;

/** The revision deep link into the web app's DB-brief route. */
export function buildEntryCommentDeepLink(
  link: EntryCommentRevisionLink,
): string {
  const origin = link.publicBaseUrl.replace(/\/+$/, "");
  return `${origin}/repos/${link.repoId}/pulls/${link.prNumber}?rev=${String(link.headIndex)}`;
}

/** The branded "ready" body posted once the brief artifact is readable. */
export function buildEntryCommentBody(
  t: TFunction,
  link: EntryCommentLink,
): string {
  const deepLink = buildEntryCommentDeepLink(link);
  const shortSha = formatShortSha(link.headSha);
  const heading = `**[${t("entryComment.ready.link")}](${deepLink})** (${shortSha})`;
  const footer = formatFooter(t("entryComment.ready.footer"));
  return [heading, "", footer].join("\n");
}

/** Where a body about the PR as a whole points: the PR view, no span. */
export interface EntryCommentPrViewLink {
  readonly publicBaseUrl: string;
  readonly repoId: bigint;
  readonly prNumber: number;
}

/** Where a body about the PR's next brief points: the rev it takes, no head named. */
export interface EntryCommentRevisionLink extends EntryCommentPrViewLink {
  /** The brief's index on this PR, the `rev` the web route addresses. */
  readonly headIndex: number;
}

/** Where a body about one head points: its revision, the head named in the body. */
export interface EntryCommentLink extends EntryCommentRevisionLink {
  /** Named in the body's short sha, never in the link. */
  readonly headSha: string;
}

/** Where the capped body points: the PR view, with no brief to deep-link. */
export interface EntryCommentCappedLink extends EntryCommentPrViewLink {
  /** The head that got no brief, named so the thread knows which push. */
  readonly headSha: string;
  /** When generation resumes, as an ISO instant (the next UTC midnight). */
  readonly resetsAt: Date;
}

/**
 * The capped body: this push got no brief because the instance hit its daily
 * generation cap. Used ONLY to UPDATE an Entry comment that already exists;
 * a capped PR never gets one created for it, so the cap can never make
 * MergeBrief louder on a thread than it already was.
 */
export function buildEntryCommentCappedBody(
  t: TFunction,
  link: EntryCommentCappedLink,
): string {
  const url = buildPrViewUrl(link);
  const shortSha = formatShortSha(link.headSha);
  const resetsAt = link.resetsAt.toISOString().replace(".000Z", "Z");
  const heading = `**${t("entryComment.capped.heading", { shortSha })}**`;
  const body = `${t("entryComment.capped.body", { resetsAt })} [${t("entryComment.capped.openLink")}](${url})`;
  const footer = formatFooter(t("entryComment.capped.footer"));
  return [heading, "", body, "", footer].join("\n");
}

/**
 * The failed body: this push's generation ended failed. Built from the code
 * alone, never a failure's detail. A transient code links Regenerate on the
 * revision this head's brief would take; every other code links that
 * revision neutrally, so the codes the public reason collapses render one
 * body and Regenerate is offered only where the signed-in UI decides it.
 */
export function buildEntryCommentFailedBody(
  t: TFunction,
  link: EntryCommentLink,
  code: GenerationFailureCode,
): string {
  const shortSha = formatShortSha(link.headSha);
  const heading = `**${t("entryComment.failed.heading", { shortSha })}**`;
  const reason = t(`entryComment.failed.reason.${code}`);
  const transient =
    GenerationFailureClassByCode[code] === GenerationFailureClasses.TRANSIENT;
  const linkText = transient
    ? t("entryComment.failed.regenerateLink")
    : t("entryComment.failed.openLink");
  const body = `${reason} [${linkText}](${buildEntryCommentDeepLink(link)})`;
  const footer = formatFooter(t("entryComment.failed.footer"));
  return [heading, "", body, "", footer].join("\n");
}

/**
 * The "generating" body posted when a fresh generation starts. Same deep
 * link: the web app's diff-first wait UX renders the live diff immediately,
 * so the link is useful minutes before the Brief lands.
 */
export function buildEntryCommentGeneratingBody(
  t: TFunction,
  link: EntryCommentLink,
): string {
  const deepLink = buildEntryCommentDeepLink(link);
  const shortSha = formatShortSha(link.headSha);
  const heading = `**[${t("entryComment.generating.link")}](${deepLink})** (${shortSha})`;
  const footer = formatFooter(t("entryComment.generating.footer"));
  return [heading, "", footer].join("\n");
}

/** The bodies naming this head that its run may leave live: generating and each failed one. */
export function buildHeadEntryBodies(
  t: TFunction,
  link: EntryCommentLink,
): string[] {
  const failedBodies = Object.values(GenerationFailureCodes).map((code) =>
    buildEntryCommentFailedBody(t, link, code),
  );
  return [buildEntryCommentGeneratingBody(t, link), ...failedBodies];
}

/**
 * The on-demand body: the PR's runs wait for a collaborator's Generate click.
 * It links the rev the next brief takes, where the web shows Generate, and
 * names no head, so a later push finds it live and does not re-ping. It says
 * nothing about why the PR waits.
 */
export function buildEntryCommentOnDemandBody(
  t: TFunction,
  link: EntryCommentRevisionLink,
): string {
  const heading = `**${t("entryComment.onDemand.heading")}**`;
  const body = `[${t("entryComment.onDemand.generateLink")}](${buildEntryCommentDeepLink(link)})`;
  const footer = formatFooter(t("entryComment.onDemand.footer"));
  return [heading, "", body, "", footer].join("\n");
}

function buildPrViewUrl(link: EntryCommentPrViewLink): string {
  const origin = link.publicBaseUrl.replace(/\/+$/, "");
  return `${origin}/repos/${link.repoId}/pulls/${link.prNumber}`;
}

function formatShortSha(headSha: string): string {
  return `\`${headSha.slice(0, SHORT_SHA_LENGTH)}\``;
}

function formatFooter(footer: string): string {
  return `<sub>${footer}</sub>`;
}
