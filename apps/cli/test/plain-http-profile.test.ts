// A profile whose base URL is plain http, over the offline runner.
import { describe, expect, it } from "vitest";
import { ExitCodes } from "../src/exit";
import { runCliOffline } from "./harness/offline";

const SPEND_BODY = JSON.stringify({
  startedRuns: 1,
  cap: 300,
  largeRuns: { runs: 0, units: 0 },
  dayStartedAt: "2026-10-28T00:00:00.000Z",
  resetsAt: "2026-10-29T00:00:00.000Z",
});

const WARNING =
  "warning: profile default sends its token over plain http to mb.internal";

function makeConfig(baseUrl: string) {
  return {
    defaultProfile: "default",
    profiles: { default: { baseUrl, token: "mergebrief_plain-http-test" } },
  };
}

function runSpendAgainst(baseUrl: string) {
  return runCliOffline(["spend"], {
    config: makeConfig(baseUrl),
    routes: [{ method: "GET", path: `${baseUrl}/api/spend`, body: SPEND_BODY }],
  });
}

describe("a profile on plain http", () => {
  it("warns that its token travels unencrypted, and never prints it", async () => {
    const run = await runSpendAgainst("http://mb.internal");

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.err).toEqual([WARNING]);
  });

  it("leaves a failed command its one error line", async () => {
    const baseUrl = "http://mb.internal";
    const notices: string[] = [];

    const run = await runCliOffline(["spend"], {
      config: makeConfig(baseUrl),
      routes: [
        {
          method: "GET",
          path: `${baseUrl}/api/spend`,
          status: 500,
          body: "{}",
        },
      ],
      successNotice: (line) => notices.push(line),
    });

    expect(run.code).not.toBe(ExitCodes.OK);
    expect(run.err).toHaveLength(1);
    expect(run.err).not.toContain(WARNING);
    expect(notices).toEqual([WARNING]);
  });

  it.each(["http://127.0.0.1:3001", "http://localhost:3001"])(
    "stays quiet for %s",
    async (baseUrl) => {
      const run = await runSpendAgainst(baseUrl);

      expect(run.code).toBe(ExitCodes.OK);
      expect(run.err).toEqual([]);
    },
  );
});
