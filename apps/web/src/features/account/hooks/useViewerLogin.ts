import { useQuery } from "@tanstack/react-query";

import { buildViewerQueryOptions } from "../queries";
import { ViewerStates } from "../types";

/** The signed-in viewer's login, off the session read the Account menu shares. */
export function useViewerLogin(): string | undefined {
  const viewer = useQuery(buildViewerQueryOptions()).data;
  const login =
    viewer?.kind === ViewerStates.SIGNED_IN ? viewer.login : undefined;
  return login;
}
