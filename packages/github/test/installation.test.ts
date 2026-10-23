// Installation presence, read on the App's own JWT: a deleted installation
// cannot mint a token, so 404 is the answer "gone", never a failure.
import { describe, expect, it } from "vitest";
import { GitHubApiErrorCodes } from "../src/errors";
import {
  CONFIRMATION_READ_TIMEOUT_MS,
  readInstallationPresence,
} from "../src/operations/installation";
import { InstallationPresences } from "../src/operations/installation/types";
import {
  makeApp,
  requireInstallationId,
  stubGitHubFetch,
  type StubResponse,
} from "./client/helpers";

const INSTALLATION_ID = requireInstallationId(99n);
const PRESENCE_PATH = "/app/installations/99";
/** Room past the read's own budget before the test itself gives up. */
const TEST_SLACK_MS = 2_000;

function answerPresence(answer: StubResponse) {
  return stubGitHubFetch(() => answer);
}

describe("readInstallationPresence", () => {
  it("reads present on a 200, asked with the App's JWT", async () => {
    const stub = answerPresence({
      status: 200,
      body: { id: 99, account: { login: "acme" } },
    });

    const result = await readInstallationPresence(
      makeApp(stub),
      INSTALLATION_ID,
    );

    expect(result).toEqual({ ok: true, value: InstallationPresences.PRESENT });
    expect(stub.requests).toEqual([
      expect.objectContaining({ method: "GET", path: PRESENCE_PATH }),
    ]);
    expect(stub.requests[0]?.authorization).toMatch(/^bearer /i);
  });

  it("reads gone on a 404", async () => {
    const stub = answerPresence({
      status: 404,
      body: { message: "Not Found" },
    });

    const result = await readInstallationPresence(
      makeApp(stub),
      INSTALLATION_ID,
    );

    expect(result).toEqual({ ok: true, value: InstallationPresences.GONE });
  });

  it("answers a sanitized failure on a 403 without the upstream text", async () => {
    const stub = answerPresence({
      status: 403,
      body: { message: "ghs_PLANTED_INSTALLATION_TOKEN refused" },
    });

    const result = await readInstallationPresence(
      makeApp(stub),
      INSTALLATION_ID,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: GitHubApiErrorCodes.FORBIDDEN,
        status: 403,
        message:
          "failed to read installation presence: GitHub API returned status 403",
      },
    });
  });

  it("asks GitHub once on a 5xx, with no retry", async () => {
    const stub = answerPresence({ status: 502, body: { message: "down" } });

    const result = await readInstallationPresence(
      makeApp(stub),
      INSTALLATION_ID,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.REQUEST_FAILED, status: 502 },
    });
    expect(stub.requests).toHaveLength(1);
  });

  it(
    "answers request-failed, never gone, when GitHub misses the deadline",
    { timeout: CONFIRMATION_READ_TIMEOUT_MS + TEST_SLACK_MS },
    async () => {
      const stub = stubGitHubFetch(() => undefined);
      const started = Date.now();

      const result = await readInstallationPresence(
        makeApp(stub),
        INSTALLATION_ID,
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code: GitHubApiErrorCodes.REQUEST_FAILED },
      });
      expect(Date.now() - started).toBeLessThan(
        CONFIRMATION_READ_TIMEOUT_MS + TEST_SLACK_MS,
      );
    },
  );
});
