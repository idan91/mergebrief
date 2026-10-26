import { createIsomorphicFn } from "@tanstack/react-start";
import type { HttpStatus } from "types";

/**
 * The status of the document a server render answers with, overriding the
 * router's own; the browser renders no document, so its side does nothing.
 * The import stays inside `.server()`: the build's import-protection denies
 * any client edge to server-only code.
 */
export const applySsrResponseStatus = createIsomorphicFn()
  .client(async (_status: HttpStatus): Promise<void> => undefined)
  .server(async (status: HttpStatus): Promise<void> => {
    const { setResponseStatus } = await import("@tanstack/react-start/server");
    setResponseStatus(status);
  });
