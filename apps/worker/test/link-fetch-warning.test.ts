import { LinkFetchModes } from "generators";
import { describe, expect, it } from "vitest";
import { buildLinkFetchWarning } from "../src/link-fetch-warning";

describe("buildLinkFetchWarning", () => {
  it("warns under the public mode and names both narrower ones", () => {
    const warning = buildLinkFetchWarning(LinkFetchModes.PUBLIC);

    expect(warning?.fields).toEqual({ evt: "link-fetch.public" });
    expect(warning?.message).toContain("off or allowlist");
  });

  it.each([LinkFetchModes.OFF, LinkFetchModes.ALLOWLIST])(
    "says nothing under the %s mode",
    (mode) => {
      expect(buildLinkFetchWarning(mode)).toBeUndefined();
    },
  );
});
