import { createIsomorphicFn } from "@tanstack/react-start";
import { WARM_SPAN_DIFF_HEADER } from "contract";

/**
 * The server render asks the api to start the span diff with the brief. The
 * browser never does: its own prefetch makes the hover decision, skipping a
 * diff past `LARGE_DIFF_FILE_COUNT` files.
 */
export const buildBriefReadHeaders = createIsomorphicFn()
  .client((): Record<string, string> => ({}))
  .server((): Record<string, string> => ({ [WARM_SPAN_DIFF_HEADER]: "1" }));
