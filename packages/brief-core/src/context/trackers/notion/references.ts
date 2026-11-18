import { TicketTrackers } from "types/trackers";
import { ReferenceLocations, type ReferenceLocation } from "../../../types";
import type { TrackerConfig } from "generators/trackers";
import {
  createEmbeddedUrlCheck,
  LINK_START,
  trimTrailingPunctuation,
} from "../../embedded-urls";
import { collectTicketKeys } from "../ticket-keys";
import type { ReferenceHit, TicketReferenceInput } from "../types";
import { normalizeNotionId } from "./utils";

const NOTION_URL = new RegExp(
  String.raw`${LINK_START}https?:\/\/(?:[a-z0-9-]+\.)?notion\.(?:so|site|com)\/[^\s<>()[\]"']*`,
  "gi",
);
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
  if (peeked !== null && /^[0-9a-f]{32}$/i.test(peeked)) {
    return peeked.toLowerCase();
  }
  const runs = url.pathname.match(HEX32);
  const last = runs?.at(-1);
  return last?.toLowerCase();
}

function collectKeys(
  text: string,
  trackers: readonly TrackerConfig[],
): ReferenceHit[] {
  const hits: ReferenceHit[] = [];

  for (const tracker of trackers) {
    if (tracker.kind !== TicketTrackers.NOTION) {
      continue;
    }
    hits.push(...collectBoardKeys(text, tracker));
  }
  return hits;
}

function collectBoardKeys(
  text: string,
  tracker: Extract<TrackerConfig, { kind: typeof TicketTrackers.NOTION }>,
): ReferenceHit[] {
  return collectTicketKeys(text, [tracker.keyPrefix]).map(({ index, key }) => ({
    index,
    reference: {
      tracker: TicketTrackers.NOTION,
      key,
      url: "",
      databaseId: tracker.databaseId,
    },
  }));
}

/** The boards a page URL may resolve in; a repo that lists none reads no page URL. */
function listBoardIds(trackers: readonly TrackerConfig[]): string[] {
  return trackers.flatMap((tracker) =>
    tracker.kind === TicketTrackers.NOTION
      ? [normalizeNotionId(tracker.databaseId)]
      : [],
  );
}

function collectPageUrls(
  text: string,
  databaseIds: readonly string[],
): ReferenceHit[] {
  if (databaseIds.length === 0) {
    return [];
  }
  const hits: ReferenceHit[] = [];
  const isEmbedded = createEmbeddedUrlCheck(text);

  for (const match of text.matchAll(NOTION_URL)) {
    if (isEmbedded(match.index)) {
      continue;
    }
    const pageId = parseNotionPageId(trimTrailingPunctuation(match[0]));
    if (pageId === undefined) {
      continue;
    }
    hits.push({
      index: match.index,
      reference: {
        tracker: TicketTrackers.NOTION,
        key: "",
        pageId,
        databaseIds,
        url: buildNotionUrl(pageId),
      },
    });
  }
  return hits;
}

/** Keys match only the configured prefix; page URLs only when a Notion read is configured and the repo lists a Notion board. */
export function collectNotionReferences(
  text: string,
  location: ReferenceLocation,
  input: TicketReferenceInput,
): ReferenceHit[] {
  const keys = collectKeys(text, input.trackers);
  if (location === ReferenceLocations.BRANCH) {
    return keys;
  }
  const databaseIds = input.readable.includes(TicketTrackers.NOTION)
    ? listBoardIds(input.trackers)
    : [];
  return [...keys, ...collectPageUrls(text, databaseIds)];
}

export function canonicalizeNotionUrl(raw: string): string | undefined {
  if (!new RegExp(`^${NOTION_URL.source}$`, "i").test(raw)) {
    return undefined;
  }
  const pageId = parseNotionPageId(raw);
  return pageId === undefined ? undefined : buildNotionUrl(pageId);
}
