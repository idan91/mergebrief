import { describe, expect, it } from "vitest";
import {
  clampRequestedRange,
  formatContentRange,
  formatUpstreamRange,
  parseContentRange,
  parseRangeHeader,
  resolveServedSlice,
} from "./byte-range";

const PIECE = 100;
const SNIFF_WINDOW = 16;

describe("parseRangeHeader", () => {
  it("reads a closed range such as WebKit's opening probe", () => {
    expect(parseRangeHeader("bytes=0-1")).toEqual({
      kind: "from",
      first: 0,
      last: 1,
    });
  });

  it("reads an open-ended range", () => {
    expect(parseRangeHeader("bytes=4096-")).toEqual({
      kind: "from",
      first: 4096,
    });
  });

  it("reads a suffix range", () => {
    expect(parseRangeHeader("bytes=-500")).toEqual({
      kind: "suffix",
      length: 500,
    });
  });

  it("reads the unit without regard to case and around spaces", () => {
    expect(parseRangeHeader("Bytes= 5-9 ")).toEqual({
      kind: "from",
      first: 5,
      last: 9,
    });
  });

  it("ignores an absent header", () => {
    expect(parseRangeHeader(undefined)).toBeUndefined();
  });

  it("ignores a multi-range request", () => {
    expect(parseRangeHeader("bytes=0-1,5-9")).toBeUndefined();
    expect(parseRangeHeader("bytes=0-1, -5")).toBeUndefined();
  });

  it("ignores garbage, other units and reversed bounds", () => {
    for (const header of [
      "",
      "bytes",
      "bytes=",
      "bytes=-",
      "bytes=abc-",
      "bytes=1-x",
      "bytes=+1-2",
      "bytes=1.5-2",
      "items=0-1",
      "bytes=9-5",
      "bytes=-0",
      "bytes=99999999999999999999-",
    ]) {
      expect(parseRangeHeader(header)).toBeUndefined();
    }
  });
});

describe("clampRequestedRange", () => {
  it("asks for the first piece when the client named no range", () => {
    expect(clampRequestedRange(undefined, PIECE)).toEqual({
      kind: "from",
      first: 0,
      last: 99,
    });
  });

  it("closes an open-ended range at one piece", () => {
    const requested = { kind: "from", first: 250 } as const;
    expect(clampRequestedRange(requested, PIECE)).toEqual({
      kind: "from",
      first: 250,
      last: 349,
    });
  });

  it("shortens a closed range longer than one piece", () => {
    const requested = { kind: "from", first: 0, last: 5000 } as const;
    expect(clampRequestedRange(requested, PIECE)).toMatchObject({ last: 99 });
  });

  it("keeps a closed range inside one piece", () => {
    const requested = { kind: "from", first: 0, last: 1 } as const;
    expect(clampRequestedRange(requested, PIECE)).toEqual(requested);
  });

  it("shortens a suffix longer than one piece", () => {
    const requested = { kind: "suffix", length: 500 } as const;
    expect(clampRequestedRange(requested, PIECE)).toEqual({
      kind: "suffix",
      length: 100,
    });
  });
});

describe("formatUpstreamRange", () => {
  it("widens a piece near the start to cover the sniffed head", () => {
    const wanted = { kind: "from", first: 0, last: 1 } as const;
    expect(formatUpstreamRange(wanted, SNIFF_WINDOW)).toBe("bytes=0-15");
  });

  it("starts at zero for a piece that begins inside the sniffed head", () => {
    const wanted = { kind: "from", first: 4, last: 50 } as const;
    expect(formatUpstreamRange(wanted, SNIFF_WINDOW)).toBe("bytes=0-50");
  });

  it("asks for a later piece as it is", () => {
    const wanted = { kind: "from", first: 200, last: 299 } as const;
    expect(formatUpstreamRange(wanted, SNIFF_WINDOW)).toBe("bytes=200-299");
  });

  it("asks for a suffix as it is", () => {
    const wanted = { kind: "suffix", length: 100 } as const;
    expect(formatUpstreamRange(wanted, SNIFF_WINDOW)).toBe("bytes=-100");
  });
});

describe("parseContentRange", () => {
  it("reads a satisfied range and its total", () => {
    expect(parseContentRange("bytes 0-15/1000")).toEqual({
      first: 0,
      last: 15,
      total: 1000,
    });
  });

  it("refuses an unknown total, reversed bounds or a range past the end", () => {
    for (const header of [
      undefined,
      "bytes 0-15/*",
      "bytes */1000",
      "bytes 9-5/1000",
      "bytes 0-1000/1000",
      "items 0-1/2",
      "bytes 0-1/2, 3-4/5",
    ]) {
      expect(parseContentRange(header)).toBeUndefined();
    }
  });
});

describe("resolveServedSlice", () => {
  it("trims a widened head back to WebKit's two bytes", () => {
    const wanted = { kind: "from", first: 0, last: 1 } as const;
    const extent = { first: 0, last: 15, total: 1000 };

    expect(resolveServedSlice(wanted, extent)).toEqual({
      ok: true,
      value: { first: 0, last: 1, total: 1000, skip: 0, length: 2 },
    });
  });

  it("skips into a widened head for a piece that starts inside it", () => {
    const wanted = { kind: "from", first: 4, last: 50 } as const;
    const extent = { first: 0, last: 50, total: 1000 };

    expect(resolveServedSlice(wanted, extent)).toEqual({
      ok: true,
      value: { first: 4, last: 50, total: 1000, skip: 4, length: 47 },
    });
  });

  it("ends the slice at the file's last byte", () => {
    const wanted = { kind: "from", first: 950, last: 1049 } as const;
    const extent = { first: 950, last: 999, total: 1000 };

    expect(resolveServedSlice(wanted, extent)).toEqual({
      ok: true,
      value: { first: 950, last: 999, total: 1000, skip: 0, length: 50 },
    });
  });

  it("cuts the first piece out of a whole-file answer", () => {
    const wanted = { kind: "from", first: 0, last: 99 } as const;
    const extent = { first: 0, last: 999, total: 1000 };

    expect(resolveServedSlice(wanted, extent)).toEqual({
      ok: true,
      value: { first: 0, last: 99, total: 1000, skip: 0, length: 100 },
    });
  });

  it("places a suffix from the total", () => {
    const wanted = { kind: "suffix", length: 100 } as const;
    const extent = { first: 900, last: 999, total: 1000 };

    expect(resolveServedSlice(wanted, extent)).toEqual({
      ok: true,
      value: { first: 900, last: 999, total: 1000, skip: 0, length: 100 },
    });
  });

  it("serves a whole short file for a longer suffix", () => {
    const wanted = { kind: "suffix", length: 100 } as const;
    const extent = { first: 0, last: 29, total: 30 };

    expect(resolveServedSlice(wanted, extent)).toEqual({
      ok: true,
      value: { first: 0, last: 29, total: 30, skip: 0, length: 30 },
    });
  });

  it("refuses a start past the end as unsatisfiable with the total", () => {
    const wanted = { kind: "from", first: 1000, last: 1099 } as const;
    const extent = { first: 0, last: 999, total: 1000 };

    expect(resolveServedSlice(wanted, extent)).toEqual({
      ok: false,
      error: { kind: "unsatisfiable", total: 1000 },
    });
  });

  it("refuses an upstream piece that does not hold the wanted start", () => {
    const wanted = { kind: "from", first: 500, last: 599 } as const;
    const extent = { first: 600, last: 699, total: 1000 };

    expect(resolveServedSlice(wanted, extent)).toEqual({
      ok: false,
      error: { kind: "not-covered" },
    });
  });
});

describe("formatContentRange", () => {
  it("writes the served slice and the total", () => {
    const slice = { first: 0, last: 1, total: 1000, skip: 0, length: 2 };
    expect(formatContentRange(slice)).toBe("bytes 0-1/1000");
  });
});
