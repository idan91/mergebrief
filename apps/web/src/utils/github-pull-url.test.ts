import { describe, expect, it } from "vitest";

import { buildGithubPullUrl } from "./github-pull-url";

describe("buildGithubPullUrl", () => {
  it("names the pull request page, or nothing without a repository name", () => {
    expect(buildGithubPullUrl("acme/payments", 7)).toBe(
      "https://github.com/acme/payments/pull/7",
    );
    expect(buildGithubPullUrl(undefined, 7)).toBeUndefined();
  });
});
