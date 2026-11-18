import { describe, expect, it } from "vitest";
import { testLogging } from "../../../../../test/logging";
import {
  RefreshErrorCodes,
  RotationFailures,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "../types";
import { answerRotationFailure } from "./refresh-failure";

const SESSION = { reviewerId: 4242n, grantId: 7n } as ViewerPrincipal;
const UNUSED_DEPS = {} as AuthRouteDeps;

describe("answerRotationFailure on a refresh that wrote nothing", () => {
  it.each([
    [RotationFailures.GITHUB_UNAVAILABLE, true],
    [RotationFailures.GRANT_BUSY, false],
  ])("answers %s as unavailable, token spent: %s", async (failure, spent) => {
    const capture = testLogging();

    const result = await answerRotationFailure(
      UNUSED_DEPS,
      SESSION,
      { reason: failure },
      capture.logger,
    );

    expect(result.ok || result.error.code).toBe(RefreshErrorCodes.UNAVAILABLE);
    const line = capture
      .lines()
      .find((entry) => entry["evt"] === "token.refresh.unavailable");
    expect(line?.["level"]).toBe("warn");
    expect(line?.["refreshTokenPossiblyConsumed"]).toBe(spent);
  });
});
