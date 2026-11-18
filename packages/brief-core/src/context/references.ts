import type { TicketTracker } from "types/trackers";
import { ReferenceLocations, type ReferenceLocation } from "../types";
import { TRACKERS } from "./trackers";
import type {
  TicketReference,
  TicketReferenceInput,
  TrackerUrlInput,
} from "./trackers/types";

const CLOSING_KEYWORDS = [
  "close",
  "closes",
  "closed",
  "fix",
  "fixes",
  "fixed",
  "resolve",
  "resolves",
  "resolved",
] as const;
/** Matches the tail of the text before a reference: `... fixes ` or `... Resolves: `. */
const CLOSING_BEFORE = new RegExp(
  `(?:^|\\s)(?:${CLOSING_KEYWORDS.join("|")}):?\\s+$`,
  "i",
);
/** Longest keyword plus `: ` is 10 chars; the window keeps the look-back linear. */
const CLOSING_WINDOW = 16;

function deriveIdentity(
  reference: Omit<TicketReference, "foundIn" | "closing">,
): string {
  if (reference.key !== "") {
    return `${reference.tracker}:${reference.key}`;
  }
  return reference.url;
}

function scanLocation(
  text: string,
  location: ReferenceLocation,
  input: TicketReferenceInput,
): TicketReference[] {
  const hits = TRACKERS.flatMap((tracker) =>
    tracker.collectReferences(text, location, input),
  );
  hits.sort((a, b) => a.index - b.index);

  return hits.map((hit) => {
    const before = text.slice(
      Math.max(0, hit.index - CLOSING_WINDOW),
      hit.index,
    );
    const closing =
      location === ReferenceLocations.DESCRIPTION &&
      CLOSING_BEFORE.test(before);
    return { ...hit.reference, foundIn: location, closing };
  });
}

/**
 * Every ticket reference in the PR, title first, then branch, then
 * description, each location in reading order; one entry per identity, the
 * first occurrence kept. The title and the branch lead because they name
 * the PR's own ticket, where a description also names tickets in passing.
 * Pure: no I/O, no config reads.
 */
export function collectTicketReferences(
  input: TicketReferenceInput,
): TicketReference[] {
  const ordered = [
    ...scanLocation(input.title, ReferenceLocations.TITLE, input),
    ...scanLocation(input.branch, ReferenceLocations.BRANCH, input),
    ...scanLocation(input.body, ReferenceLocations.DESCRIPTION, input),
  ];
  // One entry per identity, first location kept; a later closing-keyword
  // mention of the same ticket still marks it, or the closing rule would
  // hinge on which mention came first.
  const byIdentity = new Map<string, TicketReference>();
  for (const reference of ordered) {
    const identity = deriveIdentity(reference);
    const kept = byIdentity.get(identity);
    if (kept === undefined) {
      byIdentity.set(identity, reference);
    } else if (reference.closing && !kept.closing) {
      byIdentity.set(identity, { ...kept, closing: true });
    }
  }
  return [...byIdentity.values()];
}

/**
 * The canonical ticket URL for a link the PR mentions, so a trailing slash,
 * a query string or a comment fragment on the primary's URL still counts as
 * the primary. Anything no tracker owns comes back unchanged.
 */
export function canonicalizeTicketUrl(
  raw: string,
  input: TrackerUrlInput,
): string {
  for (const tracker of TRACKERS) {
    const canonical = tracker.canonicalizeUrl(raw, input);
    if (canonical !== undefined) {
      return canonical;
    }
  }
  return raw;
}

/**
 * The one ticket the PR is about. References to the repo's own trackers come
 * first (a bare `#N` in a Notion repo is usually a pull request); within
 * that pool the first in the title or the branch wins, since the list is
 * already in title, branch, description order. A closing keyword only
 * orders the description's own references: it can mark a side fix, so it
 * never outranks the title or the branch.
 */
export function resolvePrimaryTicket(
  references: readonly TicketReference[],
  trackers: readonly TicketTracker[] = [],
): TicketReference | undefined {
  const own = references.filter((reference) =>
    trackers.includes(reference.tracker),
  );
  const pool = own.length > 0 ? own : references;

  const named = pool.find(
    (reference) => reference.foundIn !== ReferenceLocations.DESCRIPTION,
  );
  return named ?? pool.find((reference) => reference.closing) ?? pool[0];
}
