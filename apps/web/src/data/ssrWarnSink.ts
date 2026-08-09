// The isomorphic warn-sink resolver. Shared client/server parsers INJECT their
// log sink rather than importing `server/logger` (which is `server-only` —
// importing it from isomorphic code would drag the server entry into the
// client bundle). This module answers the one question those call sites have:
// am I the SSR process, and if so what do I log through?
//
// `createIsomorphicFn` is REQUIRED here, not stylistic. TanStack Start's
// `import-protection` plugin walks the CLIENT module graph STATICALLY and
// denies any edge reaching `@tanstack/react-start/server-only`, including
// through a dynamic `import()`. A runtime `typeof window` guard does not help:
// the edge exists whether or not it is taken, and only `vite build` catches it
// — typecheck, test, and lint all pass. `.server()` is the construct the
// plugin strips, so the dynamic import must stay syntactically INSIDE it;
// hoisting it into a named helper re-creates the denied edge.
import { createIsomorphicFn } from "@tanstack/react-start";

/** The narrow sink shared parsers accept; `packages/logging`'s `Logger` fits. */
export interface WarnSink {
  warn(msg: string): void;
}

/**
 * The process logger when running server-side (SSR render, route loader),
 * `undefined` in the browser.
 *
 * No sink means silent, which is correct only client-side: a browser has no
 * operator to act on the warning.
 */
export const getSsrWarnSink = createIsomorphicFn()
  .client(async (): Promise<WarnSink | undefined> => undefined)
  .server(async (): Promise<WarnSink | undefined> => {
    const { getServerLogger } = await import("../server/logger");
    return getServerLogger();
  });
