// The API composes its wire lines from this template map and the catalog
// renders the same lines from `errors.<code>`. The catalog may depend only on
// `types`, so it cannot import the vocabulary; the equality is pinned here
// instead, beside the map both sides answer to.
import { describe, expect, it } from "vitest";
import { en } from "i18n";
import { ApiErrorCodes, ApiErrorEnglishByCode } from "../src/index";

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
