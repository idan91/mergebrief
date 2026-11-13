import { describe, expect, it } from "vitest";
import { JiraScopeChecks } from "../../../../../../src/context/trackers/jira/transport";
import {
  BASIC_CREDENTIAL,
  CLOUD_ID,
  makeEndlessBody,
  makeSession,
  makeTransport,
  TENANT_INFO_URL,
  readFixture,
  stubSiteFetch,
  stubStalledFetch,
  stubUnreachableFetch,
  type AnswerSource,
  type RecordedAnswer,
} from "./helpers";

async function checkScopeWith(answer: RecordedAnswer) {
  const { fetch, calls } = stubSiteFetch(answer);
  const check = await makeTransport(fetch).checkTokenScope(makeSession());
  return { check, calls };
}

describe("checkTokenScope", () => {
  it("looks up the cloud id, then asks myself with basic auth", async () => {
    const { calls } = await checkScopeWith({ status: 200, body: "{}" });

    expect(calls.map((call) => call.url)).toEqual([
      TENANT_INFO_URL,
      `https://api.atlassian.com/ex/jira/${CLOUD_ID}/rest/api/3/myself`,
    ]);
    expect(calls[0]?.headers).toEqual({ Accept: "application/json" });
    expect(calls[1]?.headers).toEqual({
      Authorization: `Basic ${BASIC_CREDENTIAL}`,
      Accept: "application/json",
    });
    expect(calls[1]?.redirect).toBe("error");
  });

  it("does not look up again once the transport knows the site", async () => {
    const { fetch, calls } = stubSiteFetch({ status: 200, body: "{}" });
    const transport = makeTransport(fetch);

    await transport.checkTokenScope(makeSession());
    await transport.checkTokenScope(makeSession());

    expect(calls.filter((call) => call.url === TENANT_INFO_URL)).toHaveLength(
      1,
    );
  });

  it.each<[string, AnswerSource]>([
    ["a 404", { status: 404, body: "" }],
    ["a server error", { status: 503, body: "" }],
    ["no cloud id", { status: 200, body: "{}" }],
    ["no connection", stubUnreachableFetch()],
  ])("reads a lookup that answers %s as unknown", async (_name, tenantInfo) => {
    const { fetch, calls } = stubSiteFetch(
      { status: 200, body: "{}" },
      tenantInfo,
    );

    const check = await makeTransport(fetch).checkTokenScope(makeSession());

    expect(check).toBe(JiraScopeChecks.UNKNOWN);
    expect(calls.map((call) => call.url)).toEqual([TENANT_INFO_URL]);
  });

  it("reads a host that is not a site as unknown without asking", async () => {
    const { fetch, calls } = stubSiteFetch({ status: 200, body: "{}" });
    const session = makeSession(undefined, "localhost");

    const check = await makeTransport(fetch).checkTokenScope(session);

    expect(check).toBe(JiraScopeChecks.UNKNOWN);
    expect(calls).toHaveLength(0);
  });

  it("reads an abort during the lookup as unknown", async () => {
    const controller = new AbortController();
    const { fetch } = stubSiteFetch(
      { status: 200, body: "{}" },
      stubStalledFetch(),
    );

    const pending = makeTransport(fetch).checkTokenScope(
      makeSession(controller.signal),
    );
    controller.abort();

    expect(await pending).toBe(JiraScopeChecks.UNKNOWN);
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
    const { fetch } = stubSiteFetch(stubUnreachableFetch());
    const transport = makeTransport(fetch);

    expect(await transport.checkTokenScope(makeSession())).toBe(
      JiraScopeChecks.UNKNOWN,
    );
  });

  it("reads an abort as unknown", async () => {
    const controller = new AbortController();
    const { fetch } = stubSiteFetch(stubStalledFetch());
    const transport = makeTransport(fetch);

    const pending = transport.checkTokenScope(makeSession(controller.signal));
    controller.abort();

    expect(await pending).toBe(JiraScopeChecks.UNKNOWN);
  });
});
