import { GenerationStatuses, PrStates, PullRequestSources } from "types";

import type { InboxItem } from "../../../../types";

/**
 * Generate now's bar, as the regenerate route holds it: an open pull request
 * in an installation, whose newest head is held, and push access.
 */
export function offersGenerateNow(item: InboxItem): boolean {
  const held = item.generation?.status === GenerationStatuses.HELD;
  const inInstallation = item.source === PullRequestSources.INSTALLATION;
  const open = item.state === PrStates.OPEN;
  return held && inInstallation && open && item.viewerCanPush;
}

/** The pull request opens in a new tab that cannot reach back into the app. */
export function openOnGithub(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
