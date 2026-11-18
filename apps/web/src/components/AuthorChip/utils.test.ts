import { describe, expect, it } from "vitest";

import { buildAuthorLinks } from "./utils";

describe("buildAuthorLinks", () => {
  it("links a user login to its profile and avatar", () => {
    expect(buildAuthorLinks("mira-k")).toEqual({
      profileUrl: "https://github.com/mira-k",
      avatarUrl: "https://github.com/mira-k.png?size=48",
    });
  });

  it("links an Enterprise Managed User login", () => {
    expect(buildAuthorLinks("mira_acme")).toEqual({
      profileUrl: "https://github.com/mira_acme",
      avatarUrl: "https://github.com/mira_acme.png?size=48",
    });
  });

  it("links a bot login to its App page without an avatar", () => {
    expect(buildAuthorLinks("dependabot[bot]")).toEqual({
      profileUrl: "https://github.com/apps/dependabot",
    });
  });

  it("refuses a value that is no GitHub login", () => {
    for (const value of [
      "",
      "-lead",
      "trail-",
      "two--hyphens",
      "_lead",
      "trail_",
      "two__underscores",
      "a/b",
      "../x",
      "x".repeat(40),
      "[bot]",
      "evil/[bot]",
    ]) {
      expect(buildAuthorLinks(value)).toBeUndefined();
    }
  });
});
