// The api composes wire lines from its own template map and the catalog
// renders the same lines from `errors.<code>`; the CLI must not pull the api
// package, so shared source is ruled out and equality is pinned here. It sits
// on the api side because nothing imports an app.
import { describe, expect, it } from "vitest";
import { en } from "i18n";
import { ApiErrorEnglishByCode, ApiErrorCodes } from "../src/index";

describe("wire error pin between api and catalog", () => {
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
