import { Providers } from "generators";
import { describe, expect, it } from "vitest";
import { buildToolAccessWarning } from "../src/tool-access";

describe("buildToolAccessWarning", () => {
  it.each([Providers.CODEX, Providers.CURSOR])(
    "tags the %s warning with the tool-access evt and provider",
    (provider) => {
      expect(buildToolAccessWarning(provider)?.fields).toEqual({
        evt: "generator.tool-access",
        provider,
      });
    },
  );

  it("names what codex and cursor can still reach", () => {
    expect(buildToolAccessWarning(Providers.CODEX)?.message).toContain(
      "newer codex",
    );
    expect(buildToolAccessWarning(Providers.CURSOR)?.message).toContain(
      "MCP servers",
    );
    expect(buildToolAccessWarning(Providers.CURSOR)?.message).toContain(
      "What stays open",
    );
  });

  it("says nothing for a provider without tool access", () => {
    expect(buildToolAccessWarning(Providers.CLAUDE_CODE)).toBeUndefined();
    expect(buildToolAccessWarning(Providers.ANTHROPIC)).toBeUndefined();
  });
});
