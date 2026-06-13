import { describe, expect, it } from "vitest";
import { isPublicUrl, parsePrUrl } from "../src/github.js";

describe("parsePrUrl", () => {
  it("parses a canonical PR URL", () => {
    expect(parsePrUrl("https://github.com/medusajs/medusa/pull/15605")).toEqual({
      owner: "medusajs",
      repo: "medusa",
      number: 15605,
    });
  });

  it("ignores trailing path, query, and fragment", () => {
    for (const url of [
      "https://github.com/medusajs/medusa/pull/15605/files",
      "https://github.com/medusajs/medusa/pull/15605?diff=split",
      "https://github.com/medusajs/medusa/pull/15605#issuecomment-1",
    ]) {
      expect(parsePrUrl(url).number).toBe(15605);
    }
  });

  it("accepts http and surrounding whitespace", () => {
    expect(parsePrUrl("  http://github.com/a/b/pull/7  ")).toEqual({
      owner: "a",
      repo: "b",
      number: 7,
    });
  });

  it("accepts dots, hyphens, and underscores in owner/repo", () => {
    expect(parsePrUrl("https://github.com/my-org/my.repo_x/pull/1")).toEqual({
      owner: "my-org",
      repo: "my.repo_x",
      number: 1,
    });
  });

  it.each([
    "not-a-pr-url",
    "https://github.com/owner/repo", // no /pull/<n>
    "https://github.com/owner/repo/pull/abc", // non-numeric
    "https://gitlab.com/owner/repo/pull/1", // wrong host
    "https://github.com/owner/repo/issues/1", // issue, not PR
  ])("rejects %s", (url) => {
    expect(() => parsePrUrl(url)).toThrow();
  });
});

describe("isPublicUrl (SSRF guard)", () => {
  // These all short-circuit before any DNS lookup, so the test stays offline.
  it.each([
    "http://localhost:6006/", // loopback by name
    "http://127.0.0.1/admin", // loopback IP
    "http://[::1]/", // loopback IPv6
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://10.0.0.1/", // private
    "http://192.168.1.1/", // private
    "http://172.16.0.1/", // private
    "http://service.local/", // mDNS
    "ftp://example.com/", // non-http scheme
    "file:///etc/passwd", // non-http scheme
    "not a url", // malformed
  ])("blocks %s", async (url) => {
    expect(await isPublicUrl(url)).toBe(false);
  });
});
