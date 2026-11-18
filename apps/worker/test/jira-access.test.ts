import { JiraScopeChecks } from "brief-core";
import { describe, expect, it } from "vitest";
import { checkJiraAccess } from "../src/jira-access";
import { captureLogger } from "./generate/helpers";
import {
  JIRA_EMAIL,
  JIRA_ROOT,
  JIRA_SITE,
  JIRA_TOKEN,
  NO_SUCH_SITE,
  PASSED,
  STUB_BUDGET_MS,
  stubJiraTransport,
  UNREACHABLE,
  type JiraStubAnswers,
} from "./helpers";

/** What the logger stamps on every line, whatever the call site wrote. */
const LINE_STAMPS = {
  time: expect.any(Number),
  pid: expect.any(Number),
  hostname: expect.any(String),
};

describe("checkJiraAccess", () => {
  it("makes no call when the config lists no Jira source", async () => {
    const { transport, lookups, sessions } = stubJiraTransport();
    const captured = captureLogger();

    const access = await checkJiraAccess(
      { env: {}, contextSources: [{ type: "notion" }] },
      { transport, log: captured.logger },
    );

    expect(access).toEqual(PASSED);
    expect(lookups).toEqual([]);
    expect(sessions).toEqual([]);
    expect(captured.readLines()).toEqual([]);
  });

  it("refuses an unset variable by name before any call", async () => {
    const { transport, lookups } = stubJiraTransport();

    const access = await checkJiraAccess(
      { ...JIRA_ROOT, env: { JIRA_EMAIL } },
      { transport, log: captureLogger().logger },
    );

    expect(access).toEqual({
      ok: false,
      error: "JIRA_API_TOKEN: jira API token env var is not set",
    });
    expect(lookups).toEqual([]);
  });

  it("refuses boot when no Jira site answers at the host", async () => {
    const { transport, sessions } = stubJiraTransport({
      cloudId: NO_SUCH_SITE,
    });
    const captured = captureLogger();

    const access = await checkJiraAccess(JIRA_ROOT, {
      transport,
      log: captured.logger,
    });

    expect(access).toEqual({
      ok: false,
      error:
        "jira: no Jira site answers at `site` acme.atlassian.net, check the `contextSources` entry of type jira",
    });
    expect(sessions).toEqual([]);
    expect(captured.readLines()).toEqual([]);
  });

  it("goes on with one info line when the site cannot be checked", async () => {
    const { transport, lookups } = stubJiraTransport({ cloudId: UNREACHABLE });
    const captured = captureLogger();

    const access = await checkJiraAccess(JIRA_ROOT, {
      transport,
      log: captured.logger,
    });

    expect(access).toEqual(PASSED);
    expect(lookups).toEqual([JIRA_SITE]);
    expect(captured.readLines()).toEqual([
      {
        ...LINE_STAMPS,
        level: "info",
        msg: "jira: the site could not be checked at boot; the first read will look it up",
        site: JIRA_SITE,
        detail: "jira unreachable",
      },
    ]);
  });

  it("skips the token check when the cloud id is unknown", async () => {
    const { transport, sessions } = stubJiraTransport({ cloudId: UNREACHABLE });

    await checkJiraAccess(JIRA_ROOT, {
      transport,
      log: captureLogger().logger,
    });

    expect(sessions).toEqual([]);
  });

  it("checks the token on the entry's site with its credential", async () => {
    const { transport, sessions } = stubJiraTransport();

    await checkJiraAccess(JIRA_ROOT, {
      transport,
      log: captureLogger().logger,
    });

    expect(sessions).toEqual([
      {
        site: JIRA_SITE,
        email: JIRA_EMAIL,
        token: JIRA_TOKEN,
        signal: expect.any(AbortSignal),
      },
    ]);
  });

  it.each([JiraScopeChecks.SCOPE_LIMITED, JiraScopeChecks.UNKNOWN])(
    "logs nothing for a token check that answers %s",
    async (scope) => {
      const { transport } = stubJiraTransport({ scope });
      const captured = captureLogger();

      const access = await checkJiraAccess(JIRA_ROOT, {
        transport,
        log: captured.logger,
      });

      expect(access).toEqual(PASSED);
      expect(captured.readLines()).toEqual([]);
    },
  );

  it("warns that a token Jira answered can do more than read", async () => {
    const { transport } = stubJiraTransport({ scope: JiraScopeChecks.BROADER });
    const captured = captureLogger();

    const access = await checkJiraAccess(JIRA_ROOT, {
      transport,
      log: captured.logger,
    });

    expect(access).toEqual(PASSED);
    expect(captured.readLines()).toEqual([
      {
        ...LINE_STAMPS,
        level: "warn",
        evt: "jira.token.check",
        outcome: "broader",
        site: JIRA_SITE,
        msg: "jira: the API token can do more than read issues; replace it with an API token with scopes that holds read:jira-work only",
      },
    ]);
  });

  it("logs an error once Jira refuses the credential", async () => {
    const { transport } = stubJiraTransport({ scope: JiraScopeChecks.REFUSED });
    const captured = captureLogger();

    const access = await checkJiraAccess(JIRA_ROOT, {
      transport,
      log: captured.logger,
    });

    expect(access).toEqual(PASSED);
    expect(captured.readLines()).toEqual([
      {
        ...LINE_STAMPS,
        level: "error",
        evt: "jira.token.check",
        outcome: "refused",
        site: JIRA_SITE,
        msg: "jira: Jira refused the account email and API token; every Jira read reports its ticket unread as no-credential until both variables are right and the worker restarts",
      },
    ]);
  });

  it("stops waiting for the site after the transport's budget", async () => {
    const { transport, sessions } = stubJiraTransport({ cloudId: "stalled" });
    const captured = captureLogger();

    const access = await checkJiraAccess(JIRA_ROOT, {
      transport,
      log: captured.logger,
    });

    expect(access).toEqual(PASSED);
    expect(sessions).toEqual([]);
    expect(captured.readLines()).toMatchObject([
      { level: "info", detail: `no answer within ${STUB_BUDGET_MS} ms` },
    ]);
  });

  it("stops waiting for the token check after the same budget", async () => {
    const { transport, sessions } = stubJiraTransport({ scope: "stalled" });
    const captured = captureLogger();

    const access = await checkJiraAccess(JIRA_ROOT, {
      transport,
      log: captured.logger,
    });

    expect(access).toEqual(PASSED);
    expect(sessions[0]?.signal.aborted).toBe(true);
    expect(captured.readLines()).toEqual([]);
  });

  it.each<[string, JiraStubAnswers]>([
    ["a host with no site", { cloudId: NO_SUCH_SITE }],
    ["an unreachable site", { cloudId: UNREACHABLE }],
    ["a broader token", { scope: JiraScopeChecks.BROADER }],
    ["a refused credential", { scope: JiraScopeChecks.REFUSED }],
  ])("keeps the email and the token out of %s", async (_label, answers) => {
    const { transport } = stubJiraTransport(answers);
    const captured = captureLogger();

    const access = await checkJiraAccess(JIRA_ROOT, {
      transport,
      log: captured.logger,
    });

    const refusal = access.ok ? "" : access.error;
    const output = JSON.stringify([captured.readLines(), refusal]);
    expect(output).toContain(JIRA_SITE);
    expect(output).not.toContain(JIRA_EMAIL);
    expect(output).not.toContain(JIRA_TOKEN);
  });
});
