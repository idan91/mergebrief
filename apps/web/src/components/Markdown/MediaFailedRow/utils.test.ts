import { describe, expect, it } from "vitest";

import {
  ATTACHMENT_ASSET_URL,
  COMMITTED_IMAGE_URL,
} from "@web/test/attachments";
import { buildGitHubOriginalLink } from "./utils";

describe("buildGitHubOriginalLink", () => {
  it.each([
    ["a pasted asset", ATTACHMENT_ASSET_URL],
    ["a committed file", COMMITTED_IMAGE_URL],
    [
      "a raw content address",
      "https://raw.githubusercontent.com/octo/hello/main/docs/a.png",
    ],
  ])("links %s on a GitHub host", (_label, address) => {
    expect(buildGitHubOriginalLink(address)).toBe(address);
  });

  it("writes the address back in its parsed form", () => {
    expect(
      buildGitHubOriginalLink("https://GitHub.com/octo/hello/raw/main/a.png"),
    ).toBe("https://github.com/octo/hello/raw/main/a.png");
  });

  it.each([
    ["an outside host", "https://example.com/a.png"],
    ["a lookalike suffix", "https://github.com.evil.example/a.png"],
    ["a lookalike prefix", "https://evilgithub.com/a.png"],
    ["a GitHub subdomain", "https://gist.github.com/a.png"],
    ["plain http", "http://github.com/octo/hello/raw/main/a.png"],
    ["credentials", "https://user:pass@github.com/octo/hello/raw/main/a.png"],
    ["a port", "https://github.com:8443/octo/hello/raw/main/a.png"],
    ["a script scheme", "javascript:alert(1)"],
    ["a same-origin path", "/api/repos/1/pulls/2/committed-file"],
    ["text that is no address", "not a url"],
  ])("gives no link for %s", (_label, address) => {
    expect(buildGitHubOriginalLink(address)).toBeUndefined();
  });
});
