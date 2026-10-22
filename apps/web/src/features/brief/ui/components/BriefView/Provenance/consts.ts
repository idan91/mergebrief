/**
 * Providers whose CLI keeps built-in tools while it reads PR text. Plain
 * data, like `ProviderBadge`'s map: client code must not load the registry.
 */
export const TOOL_ACCESS_PROVIDERS: ReadonlySet<string> = new Set([
  "codex",
  "cursor",
]);
