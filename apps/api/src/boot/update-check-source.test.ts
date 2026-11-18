import { describe, expect, it } from "vitest";
import { resolveUpdateCheckSource } from "./update-check-source";

describe("resolveUpdateCheckSource", () => {
  it("fetches the project's release manifest by default", () => {
    expect(resolveUpdateCheckSource({ enabled: true })).toEqual({
      ok: true,
      value: {
        enabled: true,
        url: expect.stringMatching(
          /^https:\/\/github\.com\/.+\/releases\/latest\/download\/version\.json$/,
        ),
      },
    });
  });

  it("takes the mirror and the switch the instance config gives", () => {
    const mirror = "https://mirror.example.test/version.json";
    expect(resolveUpdateCheckSource({ enabled: false, url: mirror })).toEqual({
      ok: true,
      value: { enabled: false, url: mirror },
    });
  });

  it.each([
    ["a relative path", "mirror/version.json"],
    ["a scheme other than http", "ftp://mirror.example.test/version.json"],
    ["credentials in the URL", "https://user:leak-marker@mirror.example.test"],
    ["an empty value", ""],
  ])("refuses %s without echoing it", (_case, url) => {
    const result = resolveUpdateCheckSource({ enabled: true, url });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid",
        issues: [
          "updateCheck.url: must be an absolute http(s) URL without credentials",
        ],
      },
    });
  });
});
