import {
  ReferenceLocations,
  TicketTrackers,
  type TrackerConfig,
} from "../tracker";
import type { ReferenceHit, Tracker } from "./types";

const NOTION_URL =
  /https?:\/\/(?:[a-z0-9-]+\.)?notion\.(?:so|site|com)\/[^\s<>()[\]"']*/gi;
const HEX32 = /[0-9a-f]{32}/gi;

function buildNotionUrl(pageId: string): string {
  return `https://www.notion.so/${pageId}`;
}

/** The page id of a Notion URL: a peeked `?p=` row wins over the path's last 32-hex run. */
export function parseNotionPageId(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const peeked = url.searchParams.get("p");
  if (peeked !== null && /^[0-9a-f]{32}$/i.test(peeked))
    return peeked.toLowerCase();
  const runs = url.pathname.match(HEX32);
  const last = runs?.at(-1);
  return last?.toLowerCase();
}

function collectKeys(
  text: string,
  tracker: TrackerConfig | undefined,
): ReferenceHit[] {
  if (tracker === undefined || tracker.kind !== TicketTrackers.NOTION)
    return [];
  const prefix = tracker.keyPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // A trailing hyphen is a branch or slug separator, never part of the key.
  const pattern = new RegExp(`(?<![\\w-])(${prefix})-(\\d+)(?!\\w)`, "gi");
  const hits: ReferenceHit[] = [];

  for (const match of text.matchAll(pattern)) {
    const key = `${tracker.keyPrefix.toUpperCase()}-${match[2]}`;
    hits.push({
      index: match.index,
      reference: {
        tracker: TicketTrackers.NOTION,
        key,
        url: "",
        databaseId: tracker.databaseId,
      },
    });
  }
  return hits;
}

function collectPageUrls(text: string, enabled: boolean): ReferenceHit[] {
  if (!enabled) return [];
  const hits: ReferenceHit[] = [];

  for (const match of text.matchAll(NOTION_URL)) {
    const pageId = parseNotionPageId(match[0].replace(/[.,;:]+$/, ""));
    if (pageId === undefined) continue;
    hits.push({
      index: match.index,
      reference: {
        tracker: TicketTrackers.NOTION,
        key: "",
        pageId,
        url: buildNotionUrl(pageId),
      },
    });
  }
  return hits;
}

/** Keys match only the configured prefix; page URLs only when a Notion token is configured. */
export const notionTracker: Tracker = {
  kind: TicketTrackers.NOTION,
  collectReferences(text, location, input) {
    const keys = collectKeys(text, input.tracker);
    if (location === ReferenceLocations.BRANCH) return keys;
    return [...keys, ...collectPageUrls(text, input.notion)];
  },
  canonicalizeUrl(raw) {
    if (!new RegExp(`^${NOTION_URL.source}$`, "i").test(raw)) return undefined;
    const pageId = parseNotionPageId(raw);
    return pageId === undefined ? undefined : buildNotionUrl(pageId);
  },
};
