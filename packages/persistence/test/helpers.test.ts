import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFixture, readTestPostgresUrl } from "./helpers";

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

describe("makeFixture", () => {
  const SMALLEST_FIXTURE_ID = 1_000_000_000_000n;
  const LARGEST_SAFE_ID = BigInt(Number.MAX_SAFE_INTEGER);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gives two fixtures made in the same millisecond different ids", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const first = makeFixture();
    const second = makeFixture();

    expect(second.tenant).not.toBe(first.tenant);
    expect(second.repoId).not.toBe(first.repoId);
  });

  it("keeps the tenant id far above any real installation id", () => {
    const fixtures = Array.from({ length: 50 }, () => makeFixture());

    for (const fixture of fixtures) {
      expect(fixture.tenant).toBeGreaterThanOrEqual(SMALLEST_FIXTURE_ID);
      expect(fixture.tenant).toBeLessThanOrEqual(LARGEST_SAFE_ID);
      expect(fixture.repoId + 1n).toBeLessThanOrEqual(LARGEST_SAFE_ID);
      expect(fixture.ctx.installationId).toBe(fixture.tenant);
    }
  });
});
