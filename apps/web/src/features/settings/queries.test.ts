import { describe, expect, it } from "vitest";

import { buildSpendQueryOptions } from "./queries";

describe("buildSpendQueryOptions", () => {
  it("refetches on focus and polls each minute only while visible", () => {
    expect(buildSpendQueryOptions()).toMatchObject({
      staleTime: 0,
      refetchOnWindowFocus: true,
      refetchInterval: 60_000,
      refetchIntervalInBackground: false,
    });
  });
});
