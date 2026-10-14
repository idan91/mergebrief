// The version wire shape: what `GET /api/version` answers and what the
// dismiss write sends. Pinned key for key so a field added on one side
// cannot drift unnoticed.
import { describe, expectTypeOf, it } from "vitest";
import type { DismissVersionNoticeBody, VersionResponse } from "../src/index";

describe("version wire shape", () => {
  it("answers version plus the optional release fields", () => {
    expectTypeOf<keyof VersionResponse>().toEqualTypeOf<
      | "version"
      | "latest"
      | "releaseNotesUrl"
      | "checkedAt"
      | "breaking"
      | "security"
      | "dismissedVersion"
    >();
    expectTypeOf<VersionResponse["version"]>().toEqualTypeOf<string>();
    expectTypeOf<VersionResponse["latest"]>().toEqualTypeOf<
      string | undefined
    >();
  });

  it("dismisses one version", () => {
    expectTypeOf<DismissVersionNoticeBody>().toEqualTypeOf<{
      readonly version: string;
    }>();
  });
});
