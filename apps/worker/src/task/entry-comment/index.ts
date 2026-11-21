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
import {
  EntryBodyKinds,
  type EntryBodyKind,
  type EntryBodyToken,
  type EntryCommentCappedLink,
  type EntryCommentHeld,
  type EntryCommentLargeRun,
  type EntryCommentLink,
  type EntryCommentPrViewLink,
  type EntryCommentRevisionLink,
} from "./types";
import { formatHeldConditionLines } from "./held-conditions";

const SHORT_SHA_LENGTH = 7;

/** Hidden in every Entry body, so a later write can find the ones a killed run left. */
const ENTRY_COMMENT_MARKER = "<!-- mergebrief-entry -->";

/** Whether `body` is an Entry comment's, by the marker every Entry body carries. */
export function isEntryCommentBody(body: string): boolean {
  return body.includes(ENTRY_COMMENT_MARKER);
}

const ENTRY_BODY_TOKEN_PATTERN =
  /<!-- mergebrief-entry-kind: ([a-z-]+)(?: head: (\S+))? -->/g;
const ENTRY_BODY_KIND_VALUES = new Set<string>(Object.values(EntryBodyKinds));

/**
 * The hidden token after the marker that says which body this is and, for a
 * body about one head, which head. Readers decide by it, never by the copy.
 */
export function formatEntryBodyToken(
  kind: EntryBodyKind,
  headSha?: string,
): string {
  const head = headSha === undefined ? "" : ` head: ${headSha}`;
  return `<!-- mergebrief-entry-kind: ${kind}${head} -->`;
}

/**
 * The body's token, its last one: the held body quotes third-party text
 * above its footer. Absent, malformed or naming an unknown kind is `undefined`.
 */
function readEntryBodyToken(body: string): EntryBodyToken | undefined {
  const matches = [...body.matchAll(ENTRY_BODY_TOKEN_PATTERN)];
  const match = matches.at(-1);
  const kind = match?.[1];
  if (kind === undefined || !isEntryBodyKind(kind)) {
    return undefined;
  }
  return { kind, headSha: match?.[2] };
}

function isEntryBodyKind(value: string): value is EntryBodyKind {
  return ENTRY_BODY_KIND_VALUES.has(value);
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
  const footer = formatFooter(
    t("entryComment.ready.footer"),
    formatEntryBodyToken(EntryBodyKinds.READY, link.headSha),
  );
  return [heading, "", footer].join("\n");
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
  const footer = formatFooter(
    t("entryComment.capped.footer"),
    formatEntryBodyToken(EntryBodyKinds.CAPPED, link.headSha),
  );
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
  const footer = formatFooter(
    t("entryComment.closed.footer"),
    formatEntryBodyToken(EntryBodyKinds.CLOSED, headSha),
  );
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
  const footer = formatFooter(
    t("entryComment.failed.footer"),
    formatEntryBodyToken(EntryBodyKinds.FAILED, link.headSha),
  );
  return [heading, "", body, "", footer].join("\n");
}

/**
 * The "generating" body posted when a fresh generation starts. Same deep
 * link: the web app's diff-first wait UX renders the live diff immediately,
 * so the link is useful minutes before the Brief lands. A multi-call run
 * edits it once after grouping with the part count and the estimate; the
 * heading stays, so the body still reads as this head's generating body.
 */
export function buildEntryCommentGeneratingBody(
  t: TFunction,
  link: EntryCommentLink,
  largeRun?: EntryCommentLargeRun,
): string {
  const deepLink = buildEntryCommentDeepLink(link);
  const shortSha = formatShortSha(link.headSha);
  const heading = `**[${t("entryComment.generating.link")}](${deepLink})** (${shortSha})`;
  const footer = formatFooter(
    t("entryComment.generating.footer"),
    formatEntryBodyToken(EntryBodyKinds.GENERATING, link.headSha),
  );
  if (largeRun === undefined) {
    return [heading, "", footer].join("\n");
  }
  const parts = t("entryComment.generating.largeParts", {
    count: largeRun.parts,
  });
  const estimate = t("entryComment.generating.largeEstimate", {
    minutes: largeRun.estimateMinutes,
  });
  return [heading, "", `${parts} ${estimate}`, "", footer].join("\n");
}

/**
 * This head's generating, failed, capped or held body. Read by the marker and the
 * kind token's head, so neither the copy nor a body's volatile parts (its
 * link's rev, a reset time) decide it. The ready and closed bodies are read
 * apart: neither is an in-progress body a run may replace on an unread PR.
 */
export function isHeadEntryBody(body: string, headSha: string): boolean {
  const token = readMarkedEntryBodyToken(body);
  if (token === undefined || token.headSha !== headSha) {
    return false;
  }
  return !isSettledKind(token.kind);
}

/** This head's closed body, which only a run that read the PR open replaces. */
export function isHeadClosedEntryBody(body: string, headSha: string): boolean {
  return isHeadKindEntryBody(body, EntryBodyKinds.CLOSED, headSha);
}

/** This head's held body, whatever conditions it lists. */
export function isHeadHeldEntryBody(body: string, headSha: string): boolean {
  return isHeadKindEntryBody(body, EntryBodyKinds.HELD, headSha);
}

/** This head's ready body, whatever revision it links. */
export function isHeadReadyEntryBody(body: string, headSha: string): boolean {
  return isHeadKindEntryBody(body, EntryBodyKinds.READY, headSha);
}

/** The on-demand body, which names no head. */
export function isOnDemandEntryBody(body: string): boolean {
  const token = readMarkedEntryBodyToken(body);
  return token?.kind === EntryBodyKinds.ON_DEMAND;
}

/** This head's body other than ready, or the on-demand body every head shares. */
export function isHeadOrOnDemandEntryBody(
  body: string,
  headSha: string,
): boolean {
  const headBody = isHeadEntryBody(body, headSha);
  const replaceable = headBody || isOnDemandEntryBody(body);
  return replaceable;
}

/**
 * Any head's Entry body but a settled one: generating, failed, capped,
 * on-demand or held, none of which a closed or merged PR should keep. A ready body
 * still links a brief, and a closed body is replaced only by a post that
 * read the PR open. A marked body with no readable token counts here too.
 */
export function isUnsettledEntryBody(body: string): boolean {
  const kind = readMarkedEntryBodyToken(body)?.kind;
  const settled = kind !== undefined && isSettledKind(kind);
  const unsettled = isEntryCommentBody(body) && !settled;
  return unsettled;
}

/**
 * What a post on a PR read as open replaces: this head's body, the on-demand
 * body, or the closed body a reopen outdated.
 */
export function isOpenHeadEntryBody(body: string, headSha: string): boolean {
  const closed = isHeadClosedEntryBody(body, headSha);
  const replaceable = closed || isHeadOrOnDemandEntryBody(body, headSha);
  return replaceable;
}

function isHeadKindEntryBody(
  body: string,
  kind: EntryBodyKind,
  headSha: string,
): boolean {
  const token = readMarkedEntryBodyToken(body);
  const matches = token?.kind === kind && token.headSha === headSha;
  return matches;
}

function isSettledKind(kind: EntryBodyKind): boolean {
  return kind === EntryBodyKinds.READY || kind === EntryBodyKinds.CLOSED;
}

/** An Entry body's token; a marked body without one is unsettled and names no head. */
function readMarkedEntryBodyToken(body: string): EntryBodyToken | undefined {
  if (!isEntryCommentBody(body)) {
    return undefined;
  }
  return readEntryBodyToken(body);
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
  const footer = formatFooter(
    t("entryComment.onDemand.footer"),
    formatEntryBodyToken(EntryBodyKinds.ON_DEMAND),
  );
  return [heading, "", body, "", footer].join("\n");
}

/**
 * The held body: trigger conditions keep this head from generating. It names
 * the head, every unmet condition with whose setting it is, a Generate link
 * on the rev the head's brief takes, and the PR's newest brief when one is
 * stored. Written by a silent edit, never a fresh ping.
 */
export function buildEntryCommentHeldBody(
  t: TFunction,
  held: EntryCommentHeld,
): string {
  const { next, previous, unmet } = held;
  const shortSha = formatShortSha(next.headSha);
  const heading = `**${t("entryComment.held.heading", { shortSha })}**`;
  const generate = `[${t("entryComment.held.generateLink")}](${buildEntryCommentDeepLink(next)})`;
  const links = [generate];
  if (previous !== undefined) {
    const label = t("entryComment.held.previousLink", {
      shortSha: formatShortSha(previous.headSha),
    });
    links.push(`[${label}](${buildEntryCommentDeepLink(previous)})`);
  }
  const footer = formatFooter(
    t("entryComment.held.footer"),
    formatEntryBodyToken(EntryBodyKinds.HELD, next.headSha),
  );
  return [
    heading,
    "",
    ...formatHeldConditionLines(t, unmet),
    "",
    links.join(" · "),
    "",
    footer,
  ].join("\n");
}

function buildPrViewUrl(link: EntryCommentPrViewLink): string {
  const origin = link.publicBaseUrl.replace(/\/+$/, "");
  return `${origin}/repos/${link.repoId}/pulls/${link.prNumber}`;
}

function formatShortSha(headSha: string): string {
  return `\`${headSha.slice(0, SHORT_SHA_LENGTH)}\``;
}

function formatFooter(footer: string, token: string): string {
  return `<sub>${footer}</sub>\n${ENTRY_COMMENT_MARKER}\n${token}`;
}
