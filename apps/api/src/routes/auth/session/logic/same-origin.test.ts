import { describe, expect, it } from "vitest";
import {
  isSafeMethod,
  isSameOriginRequest,
  resolveAllowedOrigin,
} from "./same-origin";

const ALLOWED = "https://brief.example.test";

describe("isSameOriginRequest", () => {
  it("accepts Sec-Fetch-Site same-origin with no Origin header", () => {
    expect(isSameOriginRequest({ secFetchSite: "same-origin" }, ALLOWED)).toBe(
      true,
    );
  });

  it("accepts an Origin equal to the allowed origin", () => {
    expect(isSameOriginRequest({ origin: ALLOWED }, ALLOWED)).toBe(true);
  });

  it("refuses a sibling subdomain that is same-site but not same-origin", () => {
    const headers = {
      secFetchSite: "same-site",
      origin: "https://evil.example.test",
    };
    expect(isSameOriginRequest(headers, ALLOWED)).toBe(false);
  });

  it("refuses Sec-Fetch-Site none and cross-site", () => {
    expect(isSameOriginRequest({ secFetchSite: "none" }, ALLOWED)).toBe(false);
    expect(isSameOriginRequest({ secFetchSite: "cross-site" }, ALLOWED)).toBe(
      false,
    );
  });

  it("refuses an Origin of null", () => {
    expect(isSameOriginRequest({ origin: "null" }, ALLOWED)).toBe(false);
  });

  it("refuses a request carrying neither header", () => {
    expect(isSameOriginRequest({}, ALLOWED)).toBe(false);
  });

  it("refuses an Origin on another scheme or port", () => {
    expect(
      isSameOriginRequest({ origin: "http://brief.example.test" }, ALLOWED),
    ).toBe(false);
    expect(
      isSameOriginRequest(
        { origin: "https://brief.example.test:8443" },
        ALLOWED,
      ),
    ).toBe(false);
  });

  it("refuses an Origin that only shares a prefix with the allowed one", () => {
    expect(
      isSameOriginRequest(
        { origin: "https://brief.example.test.evil" },
        ALLOWED,
      ),
    ).toBe(false);
  });
});

describe("resolveAllowedOrigin", () => {
  it("normalizes a trailing slash and a path away", () => {
    expect(resolveAllowedOrigin("https://brief.example.test/")).toBe(ALLOWED);
    expect(resolveAllowedOrigin("https://brief.example.test/app")).toBe(
      ALLOWED,
    );
  });

  it("lowercases the host and drops a default port", () => {
    expect(resolveAllowedOrigin("https://Brief.Example.test:443")).toBe(
      ALLOWED,
    );
  });

  it("keeps a non-default port", () => {
    expect(resolveAllowedOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it("throws on a value that is not a URL", () => {
    expect(() => resolveAllowedOrigin("brief.example.test")).toThrow(
      /Invalid URL/,
    );
  });
});

describe("isSafeMethod", () => {
  it("GET, HEAD and OPTIONS need no origin proof", () => {
    expect(isSafeMethod("GET")).toBe(true);
    expect(isSafeMethod("head")).toBe(true);
    expect(isSafeMethod("OPTIONS")).toBe(true);
  });

  it("POST, PUT, PATCH and DELETE do", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(isSafeMethod(method)).toBe(false);
    }
  });
});
