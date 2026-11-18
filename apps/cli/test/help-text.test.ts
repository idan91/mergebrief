import { describe, expect, it } from "vitest";
import { ExitCodes } from "../src/exit";
import { BASE_SHA, HEAD_SHA, SPAN_FLAGS } from "./harness/consts";
import {
  expectRefusedBeforeRequest,
  OFFLINE_REPO_ID,
  OFFLINE_REPOS_ROUTE,
  runCliOffline,
} from "./harness/offline";

const SUBMIT_ROUTE = {
  method: "POST",
  path: `/api/repos/${OFFLINE_REPO_ID}/pulls/7/review?base=${BASE_SHA}&head=${HEAD_SHA}`,
  status: 201,
  body: JSON.stringify({
    reviewId: 1,
    commentsDegraded: false,
    commentsFolded: 0,
    commentsTotal: 0,
  }),
};
const SUBMIT_PAYLOAD = '{"outcome":"comment"}';

function readExamplePayload(helpText: string): unknown {
  const line = helpText
    .split("\n")
    .find((candidate) => candidate.trim().startsWith("{"));
  if (line === undefined) {
    throw new Error("the help names no example payload");
  }
  return JSON.parse(line);
}

describe("--help", () => {
  it("lists the categories reclassify takes", async () => {
    const run = await runCliOffline(["reclassify", "--help"]);

    expect(run.code).toBe(ExitCodes.OK);
    for (const category of ["bugfix", "logic-refactor", "schema-change"]) {
      expect(run.out).toContain(category);
    }
  });

  it.each([
    [["draft", "create"], "filePath"],
    [["draft", "update"], "body"],
    [["draft", "reanchor"], "filePath"],
    [["risk", "dismiss"], "regionStart"],
    [["risk", "address"], "evidence"],
    [["risk", "reopen"], "regionStart"],
    [["submit"], "outcome"],
  ])("%j shows a parsable example payload", async (command, field) => {
    const run = await runCliOffline([...command, "--help"]);

    const example = JSON.stringify(readExamplePayload(run.out));

    expect(run.code).toBe(ExitCodes.OK);
    expect(example).toContain(field);
  });

  it("names the global options on a subcommand", async () => {
    const run = await runCliOffline(["pr", "--help"]);

    expect(run.out).toContain("--json");
    expect(run.out).toContain("--profile");
    expect(run.out).toContain("-R");
  });
});

describe("submit's payload flag", () => {
  it.each([["-F"], ["--payload"], ["--file"]])(
    "%s reads the payload",
    async (flag) => {
      const run = await runCliOffline(
        ["submit", "7", flag, "-", ...SPAN_FLAGS, "--json"],
        {
          stdin: SUBMIT_PAYLOAD,
          routes: [OFFLINE_REPOS_ROUTE, SUBMIT_ROUTE],
        },
      );

      expect(run.err).toEqual([]);
      expect(run.code).toBe(ExitCodes.OK);
      expect(run.requests[1]?.body).toBe(SUBMIT_PAYLOAD);
    },
  );

  it("refuses --payload together with --file", async () => {
    const run = await runCliOffline(
      ["submit", "7", "--payload", "-", "--file", "-", ...SPAN_FLAGS],
      { stdin: SUBMIT_PAYLOAD },
    );

    expectRefusedBeforeRequest(run, "--payload");
  });
});
