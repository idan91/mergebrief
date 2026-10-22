import { type Provider, Providers } from "generators";

/**
 * What a harness CLI that keeps built-in tools can still reach, said once at
 * boot so the operator who chose it hears it. Mirrors the "What stays open"
 * section of `docs/self-host/generators.md`.
 */
const TOOL_ACCESS_NOTES: Readonly<Partial<Record<Provider, string>>> = {
  [Providers.CODEX]:
    "codex runs with tool access: its shell, web search and browser, plugin and sub-agent tools are off and a permission profile keeps the rest to its own folders with no network, but built-in tools a newer codex adds are not covered until MergeBrief re-checks them, and PR text can still steer what a brief says",
  [Providers.CURSOR]:
    "cursor-agent runs with tool access: a deny-all .cursor/cli.json blocks its shell, file reads and web fetches, but your own MCP servers still load and may be reachable, CURSOR_API_KEY sits in its environment, nothing limits its network, and PR text can still steer what a brief says",
};

const TOOL_ACCESS_DOCS =
  'see "What stays open" in docs/self-host/generators.md';

export interface ToolAccessWarning {
  message: string;
  fields: { evt: "generator.tool-access"; provider: Provider };
}

/** The boot warning for a provider that runs with tool access, if it does. */
export function buildToolAccessWarning(
  provider: Provider,
): ToolAccessWarning | undefined {
  const note = TOOL_ACCESS_NOTES[provider];
  if (note === undefined) {
    return undefined;
  }
  return {
    message: `${note}; ${TOOL_ACCESS_DOCS}`,
    fields: { evt: "generator.tool-access", provider },
  };
}
