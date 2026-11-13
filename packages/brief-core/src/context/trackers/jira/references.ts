import { ContextSourceTypes, type ContextSourcesConfig } from "generators";
import { TicketTrackers } from "types/trackers";
import type { TrackerConfig } from "generators/trackers";
import { ReferenceLocations, type ReferenceLocation } from "../../../types";
import {
  createEmbeddedUrlCheck,
  LINK_START,
  trimTrailingPunctuation,
} from "../../embedded-urls";
import { collectTicketKeys, escapePattern } from "../ticket-keys";
import type {
  JiraSite,
  ReferenceHit,
  TicketReferenceInput,
  TrackerUrlInput,
} from "../types";

/** A whole issue key: Jira's project key rule, a hyphen, the issue number. */
const TICKET_KEY = /^([a-z][a-z0-9]+)-(\d+)$/i;
/** The query value a list, board or backlog link names its open issue in. */
const SELECTED_ISSUE = "selectedIssue";

/** The Jira site the instance config names; undefined with no `type: jira` entry. */
export function findJiraSite(
  contextSources: ContextSourcesConfig,
): JiraSite | undefined {
  const entry = contextSources.find(
    (source) => source.type === ContextSourceTypes.JIRA,
  );
  if (entry === undefined) {
    return undefined;
  }
  return { host: entry.site, linkHosts: entry.linkHosts ?? [] };
}

function listProjectKeys(trackers: readonly TrackerConfig[]): string[] {
  return trackers.flatMap((tracker) =>
    tracker.kind === TicketTrackers.JIRA ? tracker.projectKeys : [],
  );
}

function buildIssueUrl(site: JiraSite, key: string): string {
  return `https://${site.host}/browse/${key}`;
}

/** A key's reference; its URL is built whenever the site is known, so a key and a link to it are one ticket. */
function buildHit(
  index: number,
  key: string,
  site: JiraSite | undefined,
): ReferenceHit {
  const url = site === undefined ? "" : buildIssueUrl(site, key);
  return { index, reference: { tracker: TicketTrackers.JIRA, key, url } };
}

/**
 * A link on one of the site's own hosts, never a host that only looks like
 * Jira: the host ends at the `/`, so userinfo, a port or a longer domain is
 * another host. The link ends at a `|`, which closes a table cell.
 */
function buildSiteLinkSource(site: JiraSite): string {
  const hosts = [site.host, ...site.linkHosts].map(escapePattern).join("|");
  return String.raw`https?:\/\/(?:${hosts})\/[^\s<>()[\]"'|]*`;
}

/**
 * The issue a site link names, upper-case, when a listed project holds it:
 * the last path segment that is a whole key, else a whole-key
 * `selectedIssue`. The path decides first, so a link to an unlisted
 * project's issue stays text whatever its query says.
 */
function parseListedTicketKey(
  siteLink: string,
  projectKeys: readonly string[],
): string | undefined {
  let url: URL;
  try {
    url = new URL(trimTrailingPunctuation(siteLink));
  } catch {
    return undefined;
  }
  const segments = url.pathname.split("/");
  const inPath = segments.findLast((segment) => TICKET_KEY.test(segment));
  const named = inPath ?? url.searchParams.get(SELECTED_ISSUE) ?? "";

  const match = TICKET_KEY.exec(named);
  if (match === null) {
    return undefined;
  }
  const projectKey = (match[1] ?? "").toUpperCase();
  if (!projectKeys.includes(projectKey)) {
    return undefined;
  }
  return `${projectKey}-${match[2] ?? ""}`;
}

function collectTicketLinks(
  text: string,
  site: JiraSite,
  projectKeys: readonly string[],
): ReferenceHit[] {
  const siteLinks = new RegExp(LINK_START + buildSiteLinkSource(site), "gi");
  const isEmbedded = createEmbeddedUrlCheck(text);
  const hits: ReferenceHit[] = [];

  for (const match of text.matchAll(siteLinks)) {
    if (isEmbedded(match.index)) {
      continue;
    }
    const key = parseListedTicketKey(match[0], projectKeys);
    if (key !== undefined) {
      hits.push(buildHit(match.index, key, site));
    }
  }
  return hits;
}

/**
 * Keys under the listed project keys, in every location. Issue links to
 * those projects on the site's hosts count in the description and title,
 * and only where Jira is readable; any other prefix, project or site stays
 * text.
 */
export function collectJiraReferences(
  text: string,
  location: ReferenceLocation,
  input: TicketReferenceInput,
): ReferenceHit[] {
  const projectKeys = listProjectKeys(input.trackers);
  if (projectKeys.length === 0) {
    return [];
  }
  const site = input.jiraSite;
  const keys = collectTicketKeys(text, projectKeys).map(({ index, key }) =>
    buildHit(index, key, site),
  );

  const readsLinks =
    location !== ReferenceLocations.BRANCH &&
    input.readable.includes(TicketTrackers.JIRA);
  const skipsLinks = site === undefined || !readsLinks;
  if (skipsLinks) {
    return keys;
  }
  return [...keys, ...collectTicketLinks(text, site, projectKeys)];
}

/**
 * The issue URL on the site host for a link the parser would count as a
 * reference to a listed project, read from the link's start as the parser
 * reads it.
 */
export function canonicalizeJiraUrl(
  raw: string,
  input: TrackerUrlInput,
): string | undefined {
  const site = input.jiraSite;
  if (site === undefined) {
    return undefined;
  }
  const siteLinkStart = new RegExp(`^${buildSiteLinkSource(site)}`, "i");
  const siteLink = siteLinkStart.exec(raw);
  if (siteLink === null) {
    return undefined;
  }
  const projectKeys = listProjectKeys(input.trackers);
  const key = parseListedTicketKey(siteLink[0], projectKeys);
  return key === undefined ? undefined : buildIssueUrl(site, key);
}
