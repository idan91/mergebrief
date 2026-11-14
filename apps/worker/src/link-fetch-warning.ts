import { LinkFetchModes, type LinkFetchMode } from "generators";

export interface LinkFetchWarning {
  message: string;
  fields: { evt: "link-fetch.public" };
}

/**
 * The boot warning for the default mode, in which the worker fetches any
 * public link a pull request author writes into a description.
 */
export function buildLinkFetchWarning(
  mode: LinkFetchMode,
): LinkFetchWarning | undefined {
  if (mode !== LinkFetchModes.PUBLIC) {
    return undefined;
  }
  return {
    message:
      "link fetch is public: the worker fetches up to five http(s) links from each pull request description; set linkFetch.mode to off or allowlist to narrow it (docs/self-host/configuration.md)",
    fields: { evt: "link-fetch.public" },
  };
}
