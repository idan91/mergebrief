import { describe, expect, it } from "vitest";
import { planMediaReply, planWholeReplyDeadline } from "./media-reply";

const MAX_FILE_BYTES = 1000;
const FIRST_PIECE = { kind: "from", first: 0, last: 99 } as const;

describe("planMediaReply", () => {
  it("serves the wanted slice of a file under the cap", () => {
    const extent = { first: 0, last: 999, total: 1000 };

    expect(planMediaReply(extent, FIRST_PIECE, MAX_FILE_BYTES)).toEqual({
      ok: true,
      value: { first: 0, last: 99, total: 1000, skip: 0, length: 100 },
    });
  });

  it("refuses a file whose upstream total passes the cap", () => {
    const extent = { first: 0, last: 99, total: 1001 };

    expect(planMediaReply(extent, FIRST_PIECE, MAX_FILE_BYTES)).toEqual({
      ok: false,
      error: { kind: "too-large" },
    });
  });

  it("refuses a later piece of a file past the cap too", () => {
    const wanted = { kind: "from", first: 5000, last: 5099 } as const;
    const extent = { first: 5000, last: 5099, total: 9000 };

    expect(planMediaReply(extent, wanted, MAX_FILE_BYTES)).toEqual({
      ok: false,
      error: { kind: "too-large" },
    });
  });

  it("refuses an answer that names no size", () => {
    expect(planMediaReply(undefined, FIRST_PIECE, MAX_FILE_BYTES)).toEqual({
      ok: false,
      error: { kind: "size-unknown" },
    });
  });

  it("answers a start past the end as unsatisfiable with the total", () => {
    const wanted = { kind: "from", first: 500, last: 599 } as const;
    const extent = { first: 0, last: 99, total: 100 };

    expect(planMediaReply(extent, wanted, MAX_FILE_BYTES)).toEqual({
      ok: false,
      error: { kind: "unsatisfiable", total: 100 },
    });
  });

  it("refuses an upstream piece that misses the wanted start", () => {
    const wanted = { kind: "from", first: 500, last: 599 } as const;
    const extent = { first: 0, last: 99, total: 1000 };

    expect(planMediaReply(extent, wanted, MAX_FILE_BYTES)).toEqual({
      ok: false,
      error: { kind: "not-covered" },
    });
  });
});

describe("planWholeReplyDeadline", () => {
  const MB = 1024 * 1024;
  const CAP = 100 * MB;

  it("gives a small image the piece deadline as its floor", () => {
    const extent = { first: 0, last: 99, total: 100 };

    expect(planWholeReplyDeadline(extent, CAP)).toEqual({
      ok: true,
      value: 30_000,
    });
  });

  it("gives a large image the time its bytes take at the floor pace", () => {
    const extent = { first: 0, last: 12 * MB - 1, total: 12 * MB };

    expect(planWholeReplyDeadline(extent, CAP)).toEqual({
      ok: true,
      value: 90_000,
    });
  });

  it("refuses a declared total past the cap, however large", () => {
    const total = 10 * 1024 * MB;
    const extent = { first: 0, last: total - 1, total };

    expect(planWholeReplyDeadline(extent, CAP)).toEqual({
      ok: false,
      error: { kind: "too-large" },
    });
  });

  it("sizes an image of no named length as the largest pasted image", () => {
    expect(planWholeReplyDeadline(undefined, CAP)).toEqual({
      ok: true,
      value: 75_000,
    });
  });

  it("never sizes one past the time the cap takes at the floor pace", () => {
    expect(planWholeReplyDeadline(undefined, 6 * MB)).toEqual({
      ok: true,
      value: 45_000,
    });
  });
});
