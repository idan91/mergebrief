import { describe, expect, it } from "vitest";
import { JiraScopeChecks } from "../../../../../../src/context/trackers/jira/transport";
import {
  BASIC_CREDENTIAL,
  CLOUD_ID,
  makeEndlessBody,
  makeSession,
  makeTransport,
  readFixture,
  stubFetch,
  stubStalledFetch,
  stubUnreachableFetch,
  type RecordedAnswer,
} from "./helpers";

async function checkScopeWith(answer: RecordedAnswer) {
  const { fetch, calls } = stubFetch(answer);
  const check = await makeTransport(fetch).checkTokenScope(makeSession());
  return { check, calls };
}

describe("checkTokenScope", () => {
  it("asks myself with the token's basic auth", async () => {
    const { calls } = await checkScopeWith({ status: 200, body: "{}" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3/myself`,
    );
    expect(calls[0]?.headers).toEqual({
      Authorization: `Basic ${BASIC_CREDENTIAL}`,
      Accept: "application/json",
    });
    expect(calls[0]?.redirect).toBe("error");
  });

  it.each<[string, RecordedAnswer, string]>([
    [
      "a scope refusal",
      {
        status: 401,
        body: readFixture("error-401-scope-does-not-match.json"),
        failureCategory: "FAILURE_CLIENT_SCOPE_CHECK",
      },
      JiraScopeChecks.SCOPE_LIMITED,
    ],
    [
      "a scope refusal without its header",
      { status: 401, body: readFixture("error-401-scope-does-not-match.json") },
      JiraScopeChecks.SCOPE_LIMITED,
    ],
    [
      "a credential refusal",
      {
        status: 401,
        body: readFixture("error-401-bad-credential.json"),
        failureCategory: "FAILURE_CLIENT_AUTH",
      },
      JiraScopeChecks.REFUSED,
    ],
    [
      "a credential refusal without its header",
      { status: 401, body: readFixture("error-401-bad-credential.json") },
      JiraScopeChecks.REFUSED,
    ],
    [
      "a credential header over a scope body",
      {
        status: 401,
        body: readFixture("error-401-scope-does-not-match.json"),
        failureCategory: "FAILURE_CLIENT_AUTH",
      },
      JiraScopeChecks.REFUSED,
    ],
    [
      "a 401 with no readable body",
      { status: 401, body: "<html>" },
      JiraScopeChecks.REFUSED,
    ],
    [
      "an answer about the account",
      { status: 200, body: "not decoded" },
      JiraScopeChecks.BROADER,
    ],
    ["a forbidden answer", { status: 403, body: "" }, JiraScopeChecks.UNKNOWN],
    [
      "a 404 from the gateway",
      {
        status: 404,
        body: readFixture("error-404-wrong-cloud-id.json"),
        failureCategory: "FAILURE_CLIENT_TCS",
      },
      JiraScopeChecks.UNKNOWN,
    ],
    ["a rate limit", { status: 429, body: "" }, JiraScopeChecks.UNKNOWN],
    ["a server error", { status: 500, body: "" }, JiraScopeChecks.UNKNOWN],
  ])("reads %s as its scope check", async (_name, answer, expected) => {
    const { check } = await checkScopeWith(answer);

    expect(check).toBe(expected);
  });

  it("does not read the body of an answer about the account", async () => {
    const endless = makeEndlessBody();

    const { check } = await checkScopeWith({ status: 200, body: endless.body });

    expect(check).toBe(JiraScopeChecks.BROADER);
    expect(endless.wasCancelled()).toBe(true);
  });

  it("reads an endless 401 body as a credential refusal", async () => {
    const endless = makeEndlessBody();

    const { check } = await checkScopeWith({ status: 401, body: endless.body });

    expect(check).toBe(JiraScopeChecks.REFUSED);
    expect(endless.wasCancelled()).toBe(true);
  });

  it("reads a failed connection as unknown", async () => {
    const transport = makeTransport(stubUnreachableFetch());

    expect(await transport.checkTokenScope(makeSession())).toBe(
      JiraScopeChecks.UNKNOWN,
    );
  });

  it("reads an abort as unknown", async () => {
    const controller = new AbortController();
    const transport = makeTransport(stubStalledFetch());

    const pending = transport.checkTokenScope(makeSession(controller.signal));
    controller.abort();

    expect(await pending).toBe(JiraScopeChecks.UNKNOWN);
  });
});
