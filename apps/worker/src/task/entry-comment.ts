// The Entry comment: ONE branded comment per PR, maintained by delete+repost
// per settled head; the deep link is navigation, never a compute trigger.
// Pure builders and body readers; the delete+repost orchestration lives in `generate/logic/`.
// The body carries no secrets: a public deep link and public SHAs. The
// sentences come from the catalog; the Markdown around them is built here.
import type { TFunction } from "i18next";
import {
  GenerationFailureClassByCode,
  GenerationFailureClasses,
  type GenerationFailureCode,
  type GenerationUnitsParams,
} from "types/generations";

const SHORT_SHA_LENGTH = 7;
/** Stands in for the short sha so a heading's text around it can be matched for any head. */
const SHORT_SHA_SLOT = "SHORT_SHA_SLOT";

/** Hidden in every Entry body, so a later write can find the ones a killed run left. */
const ENTRY_COMMENT_MARKER = "<!-- mergebrief-entry -->";

/** Whether `body` is an Entry comment's, by the marker every Entry body carries. */
export function isEntryCommentBody(body: string): boolean {
  return body.includes(ENTRY_COMMENT_MARKER);
}
const ISO_DATE_END = 10;
const ISO_TIME_START = 11;
const ISO_MINUTE_END = 16;

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
  /** A large run's refusal: the heading names the runs it needed and the day's rest. */
  readonly units?: GenerationUnitsParams | undefined;
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
  const resetsAt = formatUtcMinute(link.resetsAt);
  const heading = `**${formatCappedHeading(t, shortSha, link.units)}**`;
  const next = isPastDailyCap(link.units)
    ? t("entryComment.capped.overCapBody")
    : t("entryComment.capped.body", { resetsAt });
  const body = `${next} [${t("entryComment.capped.openLink")}](${url})`;
  const footer = formatFooter(t("entryComment.capped.footer"));
  return [heading, "", body, "", footer].join("\n");
}

function formatCappedHeading(
  t: TFunction,
  shortSha: string,
  units: GenerationUnitsParams | undefined,
): string {
  if (units === undefined) {
    return t("entryComment.capped.heading", { shortSha });
  }
  if (isPastDailyCap(units)) {
    return t("entryComment.capped.overCapHeading", {
      shortSha,
      count: units.needed,
      cap: units.cap,
    });
  }
  return t("entryComment.capped.needsHeading", {
    shortSha,
    count: units.needed,
    left: units.left,
  });
}

/** No day's cap leaves room for the units a refused large run needed. */
export function isPastDailyCap(
  units: GenerationUnitsParams | undefined,
): boolean {
  return units !== undefined && units.needed >= units.cap;
}

/**
 * The closed body: the pull request closed or merged with no brief for this
 * head, so none will generate. It names the head and links nothing; it only
 * replaces a body that promised a brief, never creates the comment.
 */
export function buildEntryCommentClosedBody(
  t: TFunction,
  headSha: string,
): string {
  const shortSha = formatShortSha(headSha);
  const heading = `**${t("entryComment.closed.heading", { shortSha })}**`;
  const footer = formatFooter(t("entryComment.closed.footer"));
  return [heading, "", footer].join("\n");
}

/** `2026-10-25 00:00 UTC`: the reset as a reader writes it, not a raw ISO instant. */
function formatUtcMinute(instant: Date): string {
  const iso = instant.toISOString();
  return `${iso.slice(0, ISO_DATE_END)} ${iso.slice(ISO_TIME_START, ISO_MINUTE_END)} UTC`;
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

/**
 * This head's generating, failed or capped body. Read by the marker and the
 * head's short sha, so a body's volatile parts (its link's rev, a reset time)
 * never decide it. The ready and closed bodies are read apart: neither is
 * an in-progress body a run may replace on an unread PR.
 */
export function isHeadEntryBody(
  t: TFunction,
  body: string,
  headSha: string,
): boolean {
  const namesHead = body.includes(formatShortSha(headSha));
  const settled = isReadyBody(t, body) || isClosedBody(body, headSha, t);
  const headBody = isEntryCommentBody(body) && namesHead && !settled;
  return headBody;
}

/** This head's closed body, which only a run that read the PR open replaces. */
export function isHeadClosedEntryBody(
  t: TFunction,
  body: string,
  headSha: string,
): boolean {
  const closed = isEntryCommentBody(body) && isClosedBody(body, headSha, t);
  return closed;
}

/** This head's ready body, whatever revision it links. */
export function isHeadReadyEntryBody(
  t: TFunction,
  body: string,
  headSha: string,
): boolean {
  const namesHead = body.includes(formatShortSha(headSha));
  const ready = isEntryCommentBody(body) && namesHead && isReadyBody(t, body);
  return ready;
}

/** The on-demand body, which names no head. */
export function isOnDemandEntryBody(t: TFunction, body: string): boolean {
  const heading = `**${t("entryComment.onDemand.heading")}**`;
  const onDemand = isEntryCommentBody(body) && body.startsWith(heading);
  return onDemand;
}

/** This head's body other than ready, or the on-demand body every head shares. */
export function isHeadOrOnDemandEntryBody(
  t: TFunction,
  body: string,
  headSha: string,
): boolean {
  const headBody = isHeadEntryBody(t, body, headSha);
  const replaceable = headBody || isOnDemandEntryBody(t, body);
  return replaceable;
}

/**
 * Any head's Entry body but a settled one: generating, failed, capped or
 * on-demand, none of which a closed or merged PR should keep. A ready body
 * still links a brief, and a closed body is replaced only by a post that
 * read the PR open.
 */
export function isUnsettledEntryBody(t: TFunction, body: string): boolean {
  const settled = isReadyBody(t, body) || isAnyHeadClosedBody(t, body);
  const unsettled = isEntryCommentBody(body) && !settled;
  return unsettled;
}

/**
 * What a post on a PR read as open replaces: this head's body, the on-demand
 * body, or the closed body a reopen outdated.
 */
export function isOpenHeadEntryBody(
  t: TFunction,
  body: string,
  headSha: string,
): boolean {
  const closed = isHeadClosedEntryBody(t, body, headSha);
  const replaceable = closed || isHeadOrOnDemandEntryBody(t, body, headSha);
  return replaceable;
}

function isClosedBody(body: string, headSha: string, t: TFunction): boolean {
  const shortSha = formatShortSha(headSha);
  return body.startsWith(
    `**${t("entryComment.closed.heading", { shortSha })}**`,
  );
}

function isAnyHeadClosedBody(t: TFunction, body: string): boolean {
  const heading = t("entryComment.closed.heading", {
    shortSha: SHORT_SHA_SLOT,
  });
  const [lead = "", tail = ""] = heading.split(SHORT_SHA_SLOT);
  const [firstLine = ""] = body.split("\n");
  const closed =
    firstLine.startsWith(`**${lead}`) && firstLine.endsWith(`${tail}**`);
  return closed;
}

function isReadyBody(t: TFunction, body: string): boolean {
  return body.startsWith(`**[${t("entryComment.ready.link")}](`);
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
  return `<sub>${footer}</sub>\n${ENTRY_COMMENT_MARKER}`;
}
