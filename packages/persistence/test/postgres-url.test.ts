import { describe, expect, it } from "vitest";
import { readTestPostgresUrl } from "../src/testing";

const UNREACHABLE_URL = "postgres://test:test@127.0.0.1:1/never";

describe("readTestPostgresUrl", () => {
  it("returns undefined when the variable is unset", () => {
    expect(readTestPostgresUrl({})).toBeUndefined();
  });

  it("treats an empty variable as unset", () => {
    expect(
      readTestPostgresUrl({ MERGEBRIEF_TEST_POSTGRES_URL: "" }),
    ).toBeUndefined();
  });

  it("returns the variable when it is set", () => {
    expect(
      readTestPostgresUrl({ MERGEBRIEF_TEST_POSTGRES_URL: UNREACHABLE_URL }),
    ).toBe(UNREACHABLE_URL);
  });

  it("throws under CI when the variable is unset", () => {
    expect(() => readTestPostgresUrl({ CI: "true" })).toThrow(
      /MERGEBRIEF_TEST_POSTGRES_URL/,
    );
  });

  it("throws under CI when the variable is empty", () => {
    expect(() =>
      readTestPostgresUrl({ CI: "true", MERGEBRIEF_TEST_POSTGRES_URL: "" }),
    ).toThrow(/MERGEBRIEF_TEST_POSTGRES_URL/);
  });

  it("returns the variable under CI when it is set", () => {
    expect(
      readTestPostgresUrl({
        CI: "true",
        MERGEBRIEF_TEST_POSTGRES_URL: UNREACHABLE_URL,
      }),
    ).toBe(UNREACHABLE_URL);
  });

  it("ignores an empty CI variable", () => {
    expect(readTestPostgresUrl({ CI: "" })).toBeUndefined();
  });

  it("never reads DATABASE_URL", () => {
    expect(
      readTestPostgresUrl({ DATABASE_URL: UNREACHABLE_URL }),
    ).toBeUndefined();
  });
});
