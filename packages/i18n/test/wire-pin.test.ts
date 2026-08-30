// Drift pins for the two-places-by-design English: the api composes wire
// lines from its own template map; this catalog renders the same lines from
// `errors.<code>`. Shared source is ruled out (the CLI must not pull the api
// package), so equality is pinned here instead.
import { ApiErrorEnglishByCode, ApiErrorCodes } from "api";
import { describe, expect, it } from "vitest";
import en from "../locales/en.json";

describe("wire error pin (api ↔ catalog)", () => {
  it("errors.* keys equal the ApiErrorCode vocabulary exactly", () => {
    expect(Object.keys(en.errors).toSorted()).toEqual(
      Object.values(ApiErrorCodes).toSorted(),
    );
  });

  it("every en template equals the api's composed English line", () => {
    for (const code of Object.values(ApiErrorCodes)) {
      expect(en.errors[code], `errors.${code}`).toBe(
        ApiErrorEnglishByCode[code],
      );
    }
  });
});
