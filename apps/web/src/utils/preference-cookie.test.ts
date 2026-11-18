// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import {
  buildPreferenceCookie,
  clearPreferenceCookie,
  readCookieValue,
  writePreferenceCookie,
} from "./preference-cookie";

const NAME = "mergebrief.example";

afterEach(() => {
  clearPreferenceCookie(NAME);
});

describe("readCookieValue", () => {
  it("finds one cookie among several", () => {
    expect(readCookieValue(`a=1; ${NAME}=split; b=2`, NAME)).toBe("split");
  });

  it("is absent when the cookie is not set", () => {
    expect(readCookieValue("a=1; b=2", NAME)).toBeUndefined();
  });

  it("matches the whole name, not a prefix", () => {
    expect(readCookieValue(`x${NAME}=split`, NAME)).toBeUndefined();
  });
});

describe("buildPreferenceCookie", () => {
  it("lasts the browser's longest and rides every page request", () => {
    const cookie = buildPreferenceCookie(NAME, "1", false);

    expect(cookie).toContain(`${NAME}=1`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=34560000");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
  });

  it("is Secure on an https page", () => {
    expect(buildPreferenceCookie(NAME, "1", true)).toMatch(/; Secure$/);
  });
});

describe("writePreferenceCookie", () => {
  it("writes a value the document reads back, and clears it", () => {
    writePreferenceCookie(NAME, "520");
    expect(readCookieValue(document.cookie, NAME)).toBe("520");

    clearPreferenceCookie(NAME);
    expect(readCookieValue(document.cookie, NAME)).toBeUndefined();
  });
});
