import { createIsomorphicFn } from "@tanstack/react-start";
import type { LogFields } from "logging";

export interface WarnSink {
  warn(msg: string, fields?: LogFields): void;
}

/**
 * The process logger server-side, bound to the render's `reqId`, and
 * `undefined` in the browser, which has no operator to warn. The dynamic import stays inside `.server()`: the build's
 * import-protection denies any client edge to `server-only`, a dynamic one or
 * one behind a `typeof window` guard included, and only `vite build` sees it.
 */
export const getSsrWarnSink = createIsomorphicFn()
  .client(async (): Promise<WarnSink | undefined> => undefined)
  .server(async (): Promise<WarnSink | undefined> => {
    const [{ getServerLogger }, { readRenderRequestId }] = await Promise.all([
      import("../server/logger"),
      import("../server/request-id"),
    ]);
    const logger = getServerLogger();
    const requestId = readRenderRequestId();
    const sink =
      requestId === undefined ? logger : logger.child({ reqId: requestId });
    return sink;
  });
