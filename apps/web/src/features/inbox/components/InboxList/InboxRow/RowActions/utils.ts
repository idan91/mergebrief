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

/**
 * The every-push switch's bar, as its routes hold it: an open pull request in
 * an installation and push access, whatever its newest head's state.
 */
export function offersEveryPush(item: InboxItem): boolean {
  const inInstallation = item.source === PullRequestSources.INSTALLATION;
  const open = item.state === PrStates.OPEN;
  return inInstallation && open && item.viewerCanPush;
}

/** The pull request opens in a new tab that cannot reach back into the app. */
export function openOnGithub(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
