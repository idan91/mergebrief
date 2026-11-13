import { describe, expect, it } from "vitest";
import { JiraCloudIdFailureReasons } from "../../../../../../src/context/trackers/jira/transport";
import {
  CLOUD_ID,
  ECOSYSTEM_CLOUD_ID,
  makeEndlessBody,
  makeTransport,
  stubFetch,
  stubStalledFetch,
  stubUnreachableFetch,
  type RecordedAnswer,
} from "./helpers";

const SITE = "acme.atlassian.net";
/** Mirrors the transport's bound on a cloud id. */
const MAX_CLOUD_ID_LENGTH = 128;

async function readCloudIdWith(answer: RecordedAnswer, site = SITE) {
  const { fetch, calls } = stubFetch(answer);
  const signal = new AbortController().signal;
  const result = await makeTransport(fetch).readCloudId(site, signal);
  return { result, calls };
}

describe("readCloudId", () => {
  it("asks the site's tenant info without a credential", async () => {
    const { calls } = await readCloudIdWith({
      status: 200,
      body: JSON.stringify({ cloudId: CLOUD_ID }),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://acme.atlassian.net/_edge/tenant_info");
    expect(calls[0]?.headers).toEqual({ Accept: "application/json" });
    expect(calls[0]?.redirect).toBe("error");
  });

  it.each([CLOUD_ID, ECOSYSTEM_CLOUD_ID])(
    "answers the cloud id %s",
    async (cloudId) => {
      const { result } = await readCloudIdWith({
        status: 200,
        body: JSON.stringify({ cloudId }),
      });

      expect(result).toEqual({ ok: true, value: cloudId });
    },
  );

  it("reads a 404 as no such site", async () => {
    const { result } = await readCloudIdWith({
      status: 404,
      body: "<!DOCTYPE html><html><body>Not found</body></html>",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        reason: JiraCloudIdFailureReasons.NO_SUCH_SITE,
        detail: "jira answered 404",
      },
    });
  });

  it.each([
    "acme.atlassian.net/evil",
    "user@acme.atlassian.net",
    "acme.atlassian.net:8443",
    "a b",
    "127.0.0.1",
    "[::1]",
    "localhost",
    "metadata.internal",
    "acme.atlassian.net.example.com",
    "evil.acme.atlassian.net",
    "ACME.atlassian.net",
  ])("refuses %s as no site host without asking", async (site) => {
    const { result, calls } = await readCloudIdWith(
      { status: 200, body: "" },
      site,
    );

    expect(result).toMatchObject({
      ok: false,
      error: { reason: JiraCloudIdFailureReasons.NO_SUCH_SITE },
    });
    expect(calls).toHaveLength(0);
  });

  it.each<[string, RecordedAnswer]>([
    ["a server error", { status: 503, body: "" }],
    ["a rate limit", { status: 429, body: "" }],
    ["a forbidden answer", { status: 403, body: "" }],
    ["a body that is not JSON", { status: 200, body: "<html></html>" }],
    ["a body without a cloud id", { status: 200, body: "{}" }],
    [
      "an empty cloud id",
      { status: 200, body: JSON.stringify({ cloudId: "" }) },
    ],
    [
      "a cloud id that would rewrite the path",
      { status: 200, body: JSON.stringify({ cloudId: ".." }) },
    ],
    [
      "a cloud id past its bound",
      {
        status: 200,
        body: JSON.stringify({ cloudId: "a".repeat(MAX_CLOUD_ID_LENGTH + 1) }),
      },
    ],
  ])("reads %s as unknown", async (_name, answer) => {
    const { result } = await readCloudIdWith(answer);

    expect(result).toMatchObject({
      ok: false,
      error: { reason: JiraCloudIdFailureReasons.UNKNOWN },
    });
  });

  it("reads a body that never ends as unknown and stops reading", async () => {
    const endless = makeEndlessBody();

    const { result } = await readCloudIdWith({
      status: 200,
      body: endless.body,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { reason: JiraCloudIdFailureReasons.UNKNOWN },
    });
    expect(endless.wasCancelled()).toBe(true);
  });

  it("reads a failed connection as unknown", async () => {
    const signal = new AbortController().signal;
    const transport = makeTransport(stubUnreachableFetch());

    expect(await transport.readCloudId(SITE, signal)).toEqual({
      ok: false,
      error: {
        reason: JiraCloudIdFailureReasons.UNKNOWN,
        detail: "jira unreachable",
      },
    });
  });

  it("reads an abort as unknown", async () => {
    const controller = new AbortController();
    const transport = makeTransport(stubStalledFetch(), 250);

    const pending = transport.readCloudId(SITE, controller.signal);
    controller.abort();

    expect(await pending).toEqual({
      ok: false,
      error: {
        reason: JiraCloudIdFailureReasons.UNKNOWN,
        detail: "no answer within 250 ms",
      },
    });
  });
});
