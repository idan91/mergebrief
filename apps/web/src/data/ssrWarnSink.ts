// The isomorphic warn-sink resolver (BRIEF-44 PR 6, ADR 0034). Shared
// client/server parsers INJECT their log sink rather than importing
// `server/logger` (which is `server-only` — importing it from isomorphic code
// would drag the server entry into the client bundle). This module answers the
// one question those call sites have: "am I the SSR process, and if so what do
// I log through?"
//
// `createIsomorphicFn` is REQUIRED here, not stylistic. TanStack Start's
// `import-protection` plugin walks the CLIENT environment's module graph
// STATICALLY and denies any edge reaching `@tanstack/react-start/server-only`
// — including through a DYNAMIC `import()`. So a runtime `typeof window`
// guard does not help: the edge exists in the graph whether or not it is
// taken, and `vite build` fails the client environment with
// `[import-protection] Import denied in client environment`
// (routes/settings → features/pulls/queries → here → server/logger).
// `.server()` is the construct the plugin understands as strippable, so the
// dynamic import must stay syntactically INSIDE it — hoisting it into a named
// helper re-creates the denied edge. Same shape as `apiFetch.ts`'s `dispatch`.
//
// Both branches ARE unit-testable: vitest shares this app's vite config, so
// the same plugin rewrites the call per test environment — a node-env test
// gets the server branch, a `@vitest-environment jsdom` test gets the client
// one (verified by probing the resolved object's keys: the pino-backed
// `Logger` vs `undefined`). The raw `@tanstack/start-fn-stubs` fallback
// (`serverImpl ?? clientImpl`, i.e. server-always) only applies where the
// plugin does NOT run, which is no path this app has.
import { createIsomorphicFn } from "@tanstack/react-start";

/** The narrow sink shared parsers accept; `packages/logging`'s `Logger` fits. */
export interface WarnSink {
  warn(msg: string): void;
}

/**
 * The process logger when running server-side (SSR render, route loader),
 * `undefined` in the browser.
 *
 * `undefined` is not a gap: a browser has no operator, so a `console.warn`
 * nobody reads would not earn its level (ADR 0034 #5). The signal that matters
 * is the SSR one, because that is where a malformed stored artifact is first
 * seen and where an operator can act on it.
 */
export const getSsrWarnSink = createIsomorphicFn()
  .client(async (): Promise<WarnSink | undefined> => undefined)
  .server(async (): Promise<WarnSink | undefined> => {
    const { getServerLogger } = await import("../server/logger");
    return getServerLogger();
  });
