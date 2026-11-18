import { describe, expect, it } from "vitest";
import {
  formatServerTiming,
  runWithReadTimings,
  timeApiRead,
} from "./read-timings";
import { stubClock } from "./test-utils";

describe("runWithReadTimings", () => {
  it("records each read's method, path, start offset and duration", async () => {
    const clock = stubClock([1000, 1000, 1012.25, 1015, 1015.5, 1040, 1046]);

    const run = await runWithReadTimings(async () => {
      await timeApiRead("GET", "/api/repos/1/pulls/2/meta", async () => "meta");
      await Promise.all([
        timeApiRead("GET", "/api/repos/1/pulls/2/brief", async () => "brief"),
        timeApiRead("GET", "/api/repos/1/pulls/2/session", async () => "s"),
      ]);
      return "rendered";
    }, clock);

    expect(run.value).toBe("rendered");
    expect(run.reads).toEqual([
      {
        method: "GET",
        path: "/api/repos/1/pulls/2/meta",
        startMs: 0,
        durationMs: 12.25,
      },
      {
        method: "GET",
        path: "/api/repos/1/pulls/2/brief",
        startMs: 15,
        durationMs: 25,
      },
      {
        method: "GET",
        path: "/api/repos/1/pulls/2/session",
        startMs: 15.5,
        durationMs: 30.5,
      },
    ]);
  });

  it("drops the query string from a recorded path", async () => {
    const clock = stubClock([0, 2, 5]);

    const run = await runWithReadTimings(
      () =>
        timeApiRead(
          "GET",
          "/api/repos/1/pulls/2/brief?base=a&head=b",
          async () => 1,
        ),
      clock,
    );

    expect(run.reads).toEqual([
      {
        method: "GET",
        path: "/api/repos/1/pulls/2/brief",
        startMs: 2,
        durationMs: 3,
      },
    ]);
  });

  it("times a read that fails and passes its error on", async () => {
    const clock = stubClock([0, 1, 4]);
    const refused = new Error("refused");

    const run = await runWithReadTimings(async () => {
      const read = timeApiRead("POST", "/api/marks", async () => {
        throw refused;
      });
      await expect(read).rejects.toBe(refused);
    }, clock);

    expect(run.reads).toEqual([
      { method: "POST", path: "/api/marks", startMs: 1, durationMs: 3 },
    ]);
  });

  it("keeps the reads of two concurrent runs apart", async () => {
    const [first, second] = await Promise.all([
      runWithReadTimings(
        () => timeApiRead("GET", "/api/inbox", async () => 1),
        stubClock([0, 1, 2]),
      ),
      runWithReadTimings(
        () => timeApiRead("GET", "/api/version", async () => 2),
        stubClock([0, 3, 7]),
      ),
    ]);

    expect(first.reads).toEqual([
      { method: "GET", path: "/api/inbox", startMs: 1, durationMs: 1 },
    ]);
    expect(second.reads).toEqual([
      { method: "GET", path: "/api/version", startMs: 3, durationMs: 4 },
    ]);
  });
});

describe("timeApiRead", () => {
  it("returns the read's value outside a run without recording", async () => {
    await expect(
      timeApiRead("GET", "/api/inbox", async () => "inbox"),
    ).resolves.toBe("inbox");
  });
});

describe("formatServerTiming", () => {
  it("lists reads in start order with offsets and a total", () => {
    const header = formatServerTiming([
      {
        method: "GET",
        path: "/api/repos/1/pulls/2/meta",
        startMs: 0,
        durationMs: 12.25,
      },
      {
        method: "GET",
        path: "/api/repos/1/pulls/2/session",
        startMs: 15.5,
        durationMs: 30.54,
      },
      {
        method: "GET",
        path: "/api/repos/1/pulls/2/brief",
        startMs: 15,
        durationMs: 25,
      },
    ]);

    expect(header).toBe(
      'api;desc="GET /api/repos/1/pulls/2/meta @0ms";dur=12.3, ' +
        'api;desc="GET /api/repos/1/pulls/2/brief @15ms";dur=25, ' +
        'api;desc="GET /api/repos/1/pulls/2/session @15.5ms";dur=30.5, ' +
        "api-total;dur=46",
    );
  });

  it("escapes quotes and backslashes and strips non-printable characters", () => {
    const header = formatServerTiming([
      {
        method: "GET",
        path: '/api/a"b\\c\r\ndée',
        startMs: 1,
        durationMs: 2,
      },
    ]);

    expect(header).toBe(
      'api;desc="GET /api/a\\"b\\\\cde @1ms";dur=2, api-total;dur=2',
    );
  });

  it("yields no header for an empty log", () => {
    expect(formatServerTiming([])).toBeUndefined();
  });
});
