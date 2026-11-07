import { useQuery } from "@tanstack/react-query";
import type { AnyRouter } from "@tanstack/react-router";

import { isSignedOutError } from "../../../data/apiFetch";
import { useReloadOnChange } from "../../../hooks/useReloadOnChange";
import { buildViewerQueryOptions } from "../queries";
import { ViewerStates } from "../types";

/** Whether the settled screen already answers a sign-out with its own refusal. */
function isSignOutRefused(router: AnyRouter, signedOut: boolean): boolean {
  const refused = router.state.matches.some((match) =>
    isSignedOutError(match.error),
  );
  return signedOut && refused;
}

/**
 * Reloads the router once each time the cached viewer turns signed out or
 * back, so the route `head`s retitle the tab. Watches the cache only: it
 * never fetches the viewer.
 */
export function useReloadOnViewerChange(): void {
  const viewer = useQuery({ ...buildViewerQueryOptions(), enabled: false });
  const signedOut = viewer.data?.kind === ViewerStates.SIGNED_OUT;

  useReloadOnChange(signedOut, isSignOutRefused);
}
