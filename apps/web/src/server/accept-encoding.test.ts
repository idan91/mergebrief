import { describe, expect, it } from "vitest";
import { readAcceptedCodings } from "./accept-encoding";

describe("readAcceptedCodings", () => {
  it("keeps every listed coding and drops one weighted q=0", () => {
    expect(readAcceptedCodings("gzip, br;q=0")).toEqual(new Set(["gzip"]));
    expect(readAcceptedCodings("br;q=0.5, GZIP;q=1.0")).toEqual(
      new Set(["br", "gzip"]),
    );
    expect(readAcceptedCodings("")).toEqual(new Set());
  });
});
