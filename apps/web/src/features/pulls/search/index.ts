import type { Mutable } from "types/utils";

import { parseBriefAddressSearch } from "@web/features/brief/comparison";
import {
  conversationFilterSearch,
  parseConversationFilter,
} from "@web/features/conversation/utils";
import type { Span } from "../utils/briefRouteState";
import type { RevisionRequest } from "../utils/dbTimeline";
import type { PrBriefSearch, PrSearchChange } from "./types";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** The router decodes digits as a number; a hand-typed value may stay a string. */
function readPositiveInteger(value: unknown): number | undefined {
  let parsed = Number.NaN;
  if (typeof value === "number") {
    parsed = value;
  }
  if (typeof value === "string") {
    parsed = Number(value);
  }
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readRevisionKeys(search: Record<string, unknown>): PrBriefSearch {
  const rev = readPositiveInteger(search["rev"]);
  const head = search["head"];
  const base = search["base"];
  const keys: PrBriefSearch = {};

  if (rev !== undefined) {
    keys.rev = rev;
  }
  if (isNonEmptyString(head)) {
    keys.head = head;
  }
  if (isNonEmptyString(head) && isNonEmptyString(base)) {
    keys.base = base;
  }

  return keys;
}

/**
 * The URL's search as the PR page reads it: an unknown param or an invalid
 * value is dropped, never defaulted. `rev` selects a revision; a legacy
 * `head` still does, its `base` kept only beside it. An unknown revision
 * degrades to latest at render, not here.
 */
export function parsePrSearch(search: Record<string, unknown>): PrBriefSearch {
  const parsed: PrBriefSearch = {
    ...readRevisionKeys(search),
    ...parseBriefAddressSearch(search),
  };
  const thread = readPositiveInteger(search["thread"]);

  if (thread !== undefined) {
    parsed.thread = thread;
  }

  return {
    ...parsed,
    ...conversationFilterSearch(parseConversationFilter(search)),
  };
}

/** The search with a change laid over it, read back through the vocabulary. */
export function buildPrSearch(
  current: PrBriefSearch,
  change: PrSearchChange,
): PrBriefSearch {
  const merged: Record<string, unknown> = { ...current, ...change };

  return parsePrSearch(merged);
}

/** The revision a link asks for: `rev`, or a legacy span. */
export function readRevisionRequest(
  search: Pick<PrSearchChange, "rev" | "head" | "base">,
): RevisionRequest {
  const request: Mutable<RevisionRequest> = {};

  if (search.rev !== undefined) {
    request.rev = search.rev;
  }
  if (search.head !== undefined) {
    request.head = search.head;
  }
  if (search.base !== undefined) {
    request.base = search.base;
  }

  return request;
}

/** Both or neither: a lone legacy key cannot address a span. */
export function readExplicitSpan(
  search: Pick<PrSearchChange, "head" | "base">,
): Span | undefined {
  if (search.base === undefined || search.head === undefined) {
    return undefined;
  }

  return { base: search.base, head: search.head };
}
