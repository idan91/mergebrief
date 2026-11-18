import { parseSearchWith } from "@tanstack/react-router";

/**
 * One search value read as JSON, except a number that would not print back as
 * the text it came from: an all-digit commit SHA, or digits around one `e`,
 * stays that text instead of collapsing into a float.
 */
function parseSearchValue(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  const lossy = typeof parsed === "number" && String(parsed) !== value;

  return lossy ? value : parsed;
}

/** The router's search parse: TanStack's JSON reading, minus lossy numbers. */
export const parseRouteSearch = parseSearchWith(parseSearchValue);
