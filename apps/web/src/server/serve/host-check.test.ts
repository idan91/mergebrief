import { describe, expect, it } from "vitest";
import { isAllowedHost, parseAllowedHosts } from "./host-check";

function readAllowed(publicBaseUrl: string | undefined): ReadonlySet<string> {
  const parsed = parseAllowedHosts(publicBaseUrl);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.value;
}

describe("parseAllowedHosts", () => {
  it("allows the public hostname and localhost", () => {
    expect([...readAllowed("https://brief.example.com/")]).toEqual([
      "localhost",
      "brief.example.com",
    ]);
  });

  it("allows only localhost when the public URL is unset", () => {
    expect([...readAllowed(undefined)]).toEqual(["localhost"]);
    expect([...readAllowed("")]).toEqual(["localhost"]);
  });

  it("refuses an unparseable public URL instead of opening the guard", () => {
    expect(parseAllowedHosts("not a url")).toEqual({
      ok: false,
      error: "PUBLIC_BASE_URL is not a URL",
    });
  });
});

describe("isAllowedHost", () => {
  const allowed = readAllowed("https://brief.example.com");

  it("accepts the public hostname with or without a port", () => {
    expect(isAllowedHost("brief.example.com", allowed)).toBe(true);
    expect(isAllowedHost("brief.example.com:443", allowed)).toBe(true);
  });

  it("accepts localhost, a .localhost name and bare IPs", () => {
    expect(isAllowedHost("localhost:3000", allowed)).toBe(true);
    expect(isAllowedHost("app.localhost", allowed)).toBe(true);
    expect(isAllowedHost("127.0.0.1:3000", allowed)).toBe(true);
    expect(isAllowedHost("[::1]:3000", allowed)).toBe(true);
  });

  it("refuses a name that only resolves here", () => {
    expect(isAllowedHost("evil.example.net", allowed)).toBe(false);
    expect(isAllowedHost("brief.example.com.evil.net", allowed)).toBe(false);
  });

  it("refuses a missing or malformed host", () => {
    expect(isAllowedHost(null, allowed)).toBe(false);
    expect(isAllowedHost("bad host/", allowed)).toBe(false);
  });
});
