import { describe, expect, it } from "vitest";
import {
  extractLinks,
  isPublicUrl,
  urlContextProvider,
} from "../../src/context/providers/url";
import { ContextProviderTypes } from "../../src/context/types";

function stubDeps(logs: string[] = []) {
  return {
    log: (m: string) => logs.push(m),
    signal: new AbortController().signal,
  };
}

describe("isPublicUrl (SSRF pre-filter)", () => {
  // Synchronous gate — no DNS. The authoritative check is at connect time.
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
    "http://user:pass@example.com/", // embedded credentials
    "not a url", // malformed
  ])("blocks %s", (url) => {
    expect(isPublicUrl(url)).toBe(false);
  });

  it("allows a plain public URL", () => {
    expect(isPublicUrl("https://example.com/docs/a.md")).toBe(true);
  });
});

describe("extractLinks", () => {
  it("dedupes, trims trailing punctuation and caps at five", () => {
    const body = [
      "see https://a.example/one.",
      "and https://a.example/one, again",
      "https://a.example/two; https://a.example/three",
      "https://a.example/four https://a.example/five https://a.example/six",
    ].join("\n");
    expect(extractLinks(body)).toEqual([
      "https://a.example/one",
      "https://a.example/two",
      "https://a.example/three",
      "https://a.example/four",
      "https://a.example/five",
    ]);
  });
});

describe("urlContextProvider", () => {
  it("is the built-in url provider and skips a blocked link without failing the read", async () => {
    const logs: string[] = [];
    expect(urlContextProvider.providerId).toBe(ContextProviderTypes.URL);

    const outcome = await urlContextProvider.fetch(
      { title: "t", body: "internal: http://127.0.0.1/admin" },
      stubDeps(logs),
    );

    expect(outcome).toEqual({ ok: true, value: [] });
    expect(logs.some((l) => l.includes("blocked"))).toBe(true);
  });

  it("returns nothing for a body with no links", async () => {
    const outcome = await urlContextProvider.fetch(
      { title: "t", body: "plain" },
      stubDeps(),
    );
    expect(outcome).toEqual({ ok: true, value: [] });
  });
});
