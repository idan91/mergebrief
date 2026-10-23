import { createUrlContextProvider } from "./providers/url";
import type { ContextProvider } from "./types";

/** The generic sources every root runs, in fan-out order: the URL chaser. */
export function createBuiltInContextProviders(): ContextProvider[] {
  return [createUrlContextProvider()];
}
