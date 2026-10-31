import { WARM_SPAN_DIFF_HEADER } from "contract";
import { describe, expect, it } from "vitest";

import { buildBriefReadHeaders } from "./brief-read-headers";

describe("buildBriefReadHeaders on the server", () => {
  it("asks the api to warm the span diff during the server render", () => {
    expect(typeof window).toBe("undefined");
    expect(buildBriefReadHeaders()).toEqual({ [WARM_SPAN_DIFF_HEADER]: "1" });
  });
});
