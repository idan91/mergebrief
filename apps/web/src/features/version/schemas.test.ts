import type { VersionResponse } from "contract";
import { describe, expect, it } from "vitest";
import type { Equals } from "types/utils";
import type { z } from "zod/v4";

import { UNSAFE_LINKS } from "@web/test/links";

import { parseVersion, type versionResponseSchema } from "./schemas";

const versionResponsePin = true satisfies Equals<
  z.output<typeof versionResponseSchema>,
  VersionResponse
>;

const FULL_BODY = {
  version: "1.4.0",
  latest: "1.5.0",
  releaseNotesUrl: "https://example.com/notes",
  checkedAt: "2026-10-11T00:00:00.000Z",
  dismissedVersion: "1.3.0",
  breaking: false,
  security: true,
};

describe("parseVersion", () => {
  it("reads every field of the version body", () => {
    expect(parseVersion(FULL_BODY)).toEqual({ ok: true, value: FULL_BODY });
  });

  it("drops a mistyped optional field and keeps the snapshot", () => {
    const parsed = parseVersion({ version: "1.4.0", latest: 5, breaking: "x" });

    expect(parsed).toEqual({ ok: true, value: { version: "1.4.0" } });
    if (!parsed.ok) {
      throw new Error("unreachable");
    }
    expect(Object.keys(parsed.value)).toEqual(["version"]);
  });

  it.each(UNSAFE_LINKS)("drops release notes url %j", (link) => {
    const parsed = parseVersion({ version: "1.4.0", releaseNotesUrl: link });

    expect(parsed).toEqual({ ok: true, value: { version: "1.4.0" } });
  });

  it("drops fields the wire adds", () => {
    expect(parseVersion({ version: "1.4.0", extra: true })).toEqual({
      ok: true,
      value: { version: "1.4.0" },
    });
  });

  it("pins the schema to the contract's VersionResponse", () => {
    expect(versionResponsePin).toBe(true);
  });

  it("refuses a body without a version", () => {
    expect(parseVersion({ latest: "1.5.0" }).ok).toBe(false);
    expect(parseVersion(null).ok).toBe(false);
  });
});
