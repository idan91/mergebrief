import { describe, expect, it } from "vitest";
import { shapePlainHttpLogLine } from "../src/plain-http-warning";

describe("shapePlainHttpLogLine", () => {
  it("tags the generator's warning with its event and host", () => {
    const line = shapePlainHttpLogLine({
      message: "generator.baseUrl uses plain http to gateway.internal",
      host: "gateway.internal",
    });

    expect(line).toEqual({
      message: "generator.baseUrl uses plain http to gateway.internal",
      fields: { evt: "generator.plain-http", host: "gateway.internal" },
    });
  });
});
