import { createIsomorphicFn } from "@tanstack/react-start";
import { WARM_SPAN_DIFF_HEADER } from "contract";

/**
 * The server render asks the api to start the span diff with the brief. The
 * browser never does: it starts the diff itself, and a hover preload must
 * not pull a diff nobody opens.
 */
export const buildBriefReadHeaders = createIsomorphicFn()
  .client((): Record<string, string> => ({}))
  .server((): Record<string, string> => ({ [WARM_SPAN_DIFF_HEADER]: "1" }));
