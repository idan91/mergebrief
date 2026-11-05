// Pure-unit coverage for the contract surfaces: the exit-code mapping table
// (additive-only, never renumbered), profile resolution order (locked),
// origin-URL parsing, and the client's proxy/IdP detection.
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { CLI_VERSION, createApiClient } from "../src/client";
import {
  fullNameFromOriginUrl,
  ownerFromOriginUrl,
  resolveProfile,
  saveConfig,
  type CliConfig,
} from "../src/profile/config";
import { CliError, ExitCodes, exitCodeForStatus } from "../src/exit";
import { expectRefusedBeforeRequest, runCliOffline } from "./harness/offline";

describe("exit-code mapping, the contract table", () => {
  it.each([
    [401, ExitCodes.AUTH],
    [404, ExitCodes.NOT_FOUND],
    [400, ExitCodes.SERVER_REJECTED],
    [403, ExitCodes.SERVER_REJECTED],
    [409, ExitCodes.SERVER_REJECTED],
    [422, ExitCodes.SERVER_REJECTED],
    [429, ExitCodes.RATE_LIMITED],
    [500, ExitCodes.GENERIC],
    [502, ExitCodes.GENERIC],
    [503, ExitCodes.GENERIC],
  ])("HTTP %i → exit %i", (status, code) => {
    expect(exitCodeForStatus(status)).toBe(code);
  });

  it("pins the numeric values, additive-only and never renumbered", () => {
    expect(ExitCodes).toEqual({
      OK: 0,
      GENERIC: 1,
      USAGE: 2,
      AUTH: 3,
      NOT_FOUND: 4,
      SERVER_REJECTED: 5,
      INCOMPATIBLE: 6,
      RATE_LIMITED: 7,
    });
  });
});

describe("profile resolution order", () => {
  const config: CliConfig = {
    defaultProfile: "work",
    profiles: {
      work: {
        baseUrl: "https://mb.work.example",
        token: "mergebrief_work",
        owners: ["acme"],
      },
      oss: {
        baseUrl: "https://mb.oss.example",
        token: "mergebrief_oss",
        owners: ["octo"],
      },
    },
  };

  it("explicit flag wins over everything", () => {
    const resolved = resolveProfile({
      config,
      env: { MERGEBRIEF_PROFILE: "work" },
      flagProfile: "oss",
      gitRemoteOwner: "acme",
    });
    expect(resolved.name).toBe("oss");
  });

  it("env names the profile when no flag", () => {
    const resolved = resolveProfile({
      config,
      env: { MERGEBRIEF_PROFILE: "oss" },
      gitRemoteOwner: "acme",
    });
    expect(resolved.name).toBe("oss");
  });

  it("owners: match on the git-remote owner beats the default", () => {
    const resolved = resolveProfile({
      config,
      env: {},
      gitRemoteOwner: "octo",
    });
    expect(resolved.name).toBe("oss");
  });

  it("falls back to the default profile", () => {
    const resolved = resolveProfile({
      config,
      env: {},
      gitRemoteOwner: "unknown-org",
    });
    expect(resolved.name).toBe("work");
  });

  it("MERGEBRIEF_TOKEN overrides the stored token, never the profile", () => {
    const resolved = resolveProfile({
      config,
      env: { MERGEBRIEF_TOKEN: "mergebrief_override" },
      flagProfile: "oss",
      gitRemoteOwner: "acme",
    });
    expect(resolved.name).toBe("oss");
    expect(resolved.token).toBe("mergebrief_override");
  });

  it("a named-but-missing profile is a USAGE error, never a silent fallback", () => {
    let thrown: unknown;
    try {
      resolveProfile({ config, env: {}, flagProfile: "nope" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CliError);
    expect(thrown instanceof CliError ? thrown.code : undefined).toBe(
      ExitCodes.USAGE,
    );
  });

  it("no profiles at all is a USAGE error pointing at auth login", () => {
    expect(() =>
      resolveProfile({ config: { profiles: {} }, env: {} }),
    ).toThrowError(/auth login/);
  });
});

describe("origin-URL parsing", () => {
  it.each([
    ["git@github.com:acme/widgets.git", "acme", "acme/widgets"],
    ["https://github.com/acme/widgets.git", "acme", "acme/widgets"],
    ["https://github.com/acme/widgets", "acme", "acme/widgets"],
    ["ssh://git@github.example.com/octo/deep.git", "octo", "octo/deep"],
  ])("%s → owner %s, fullName %s", (url, owner, fullName) => {
    expect(ownerFromOriginUrl(url)).toBe(owner);
    expect(fullNameFromOriginUrl(url)).toBe(fullName);
  });
});

function clientWith(response: Response, now: () => number = Date.now) {
  return createApiClient({
    fetch: async () => response,
    baseUrl: "https://mb.example",
    token: "mergebrief_x",
    now,
  });
}

describe("client user-agent", () => {
  it("sends mergebrief/<version> from the build-time define", async () => {
    const seen: { agent: string | undefined } = { agent: undefined };
    const client = createApiClient({
      fetch: async (_input, init) => {
        seen.agent = init?.headers?.["user-agent"];
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      baseUrl: "https://mb.example",
      token: "mergebrief_x",
    });
    await client.request({ path: "/api/version" });
    expect(seen.agent).toBe(`mergebrief/${CLI_VERSION}`);
    expect(CLI_VERSION).toBe(pkg.version);
  });
});

describe("client proxy/IdP detection", () => {
  it("a redirect is surfaced as the IdP hint, not followed", async () => {
    const client = clientWith(
      new Response(null, {
        status: 302,
        headers: { location: "https://idp/login" },
      }),
    );
    await expect(
      client.request({ path: "/api/version" }),
    ).rejects.toMatchObject({
      code: ExitCodes.GENERIC,
      message: expect.stringContaining("identity-provider"),
    });
  });

  it("an HTML body is surfaced as the IdP hint even on a 200", async () => {
    const client = clientWith(
      new Response("<html><body>Login</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );
    await expect(
      client.request({ path: "/api/version" }),
    ).rejects.toMatchObject({
      code: ExitCodes.GENERIC,
    });
  });

  it("renders a known wire code from the catalog", async () => {
    const client = clientWith(
      new Response(
        JSON.stringify({ error: "server line", code: "diff-too-large" }),
        { status: 413, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      client.request({ path: "/api/generate" }),
    ).rejects.toMatchObject({
      message: "diff too large to render (HTTP 413)",
    });
  });

  it("relays an unknown wire code's error text verbatim", async () => {
    const client = clientWith(
      new Response(
        JSON.stringify({ error: "brand new failure", code: "not-yet-known" }),
        { status: 502, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      client.request({ path: "/api/version" }),
    ).rejects.toMatchObject({
      message: "brand new failure (HTTP 502)",
    });
  });

  it("names the deployment on a failure with no error text", async () => {
    const client = clientWith(new Response("bad gateway", { status: 502 }));
    await expect(
      client.request({ path: "/api/version" }),
    ).rejects.toMatchObject({
      code: ExitCodes.GENERIC,
      message: "request failed (HTTP 502) from https://mb.example",
    });
  });

  it("relays the server's error text + status in one line", async () => {
    const client = clientWith(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(
      client.request({ path: "/api/version" }),
    ).rejects.toMatchObject({
      code: ExitCodes.AUTH,
      message: "unauthorized (HTTP 401)",
    });
  });
});

function makeLimitResponse(headers: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      error: "attachment limit reached",
      code: "attachment-limit-reached",
    }),
    {
      status: 429,
      headers: { "content-type": "application/json", ...headers },
    },
  );
}

const RETRY_AT = "Wed, 21 Oct 2026 07:28:00 GMT";
const RETRY_AT_MS = Date.UTC(2026, 9, 21, 7, 28, 0);
const JUST_UNDER_TWO_MINUTES_MS = 119_500;
const FIVE_SECONDS_MS = 5_000;

describe("client rate limiting", () => {
  const attachPath = "/api/repos/1/pulls/2/attachments";

  it("a 429 exits 7 and names the retry-after wait in seconds", async () => {
    const client = clientWith(makeLimitResponse({ "retry-after": "120" }));
    await expect(client.request({ path: attachPath })).rejects.toMatchObject({
      code: ExitCodes.RATE_LIMITED,
      message:
        "attachment limit reached, try again later (HTTP 429, retry after 120s)",
    });
  });

  it("a 429 without retry-after keeps the plain status line", async () => {
    const client = clientWith(makeLimitResponse({}));
    await expect(client.request({ path: attachPath })).rejects.toMatchObject({
      code: ExitCodes.RATE_LIMITED,
      message: "attachment limit reached, try again later (HTTP 429)",
    });
  });

  it("names the seconds until an HTTP-date retry-after, rounded up", async () => {
    const client = clientWith(
      makeLimitResponse({ "retry-after": RETRY_AT }),
      () => RETRY_AT_MS - JUST_UNDER_TWO_MINUTES_MS,
    );
    await expect(client.request({ path: attachPath })).rejects.toMatchObject({
      code: ExitCodes.RATE_LIMITED,
      message:
        "attachment limit reached, try again later (HTTP 429, retry after 120s)",
    });
  });

  it("names a wait of 0s for an HTTP-date retry-after in the past", async () => {
    const client = clientWith(
      makeLimitResponse({ "retry-after": RETRY_AT }),
      () => RETRY_AT_MS + FIVE_SECONDS_MS,
    );
    await expect(client.request({ path: attachPath })).rejects.toMatchObject({
      code: ExitCodes.RATE_LIMITED,
      message:
        "attachment limit reached, try again later (HTTP 429, retry after 0s)",
    });
  });

  it.each([
    "soon",
    "1.5",
    "-3",
    "12s",
    "Wed, 21 Oct 2026 07:28:00",
    "Wed, 21 Oct 2026 07:28:00 PST",
    "21 Oct 2026 07:28:00 GMT",
    "Wednesday, 21-Oct-26 07:28:00 GMT",
  ])("ignores a retry-after of %s", async (retryAfter) => {
    const client = clientWith(
      makeLimitResponse({ "retry-after": retryAfter }),
      () => RETRY_AT_MS,
    );
    await expect(client.request({ path: attachPath })).rejects.toMatchObject({
      code: ExitCodes.RATE_LIMITED,
      message: "attachment limit reached, try again later (HTTP 429)",
    });
  });
});

describe("saveConfig permissions", () => {
  it("re-tightens an existing config file to 0600 on rewrite", () => {
    const tempRoot = tmpdir();
    const dir = mkdtempSync(join(tempRoot, "mb-cfg-"));
    // Pre-existing world-readable file (created before the CLI owned it).
    writeFileSync(join(dir, "config.json"), "{}", { mode: 0o644 });
    saveConfig(dir, { profiles: {} });
    expect(statSync(join(dir, "config.json")).mode & 0o777).toBe(0o600);
  });
});

describe("mergebrief --version", () => {
  it("prints the build-time version and exits 0", async () => {
    const { code, out, err, requests } = await runCliOffline(["--version"]);

    expect(code).toBe(ExitCodes.OK);
    expect(out).toBe(`${pkg.version}\n`);
    expect(err).toEqual([]);
    expect(requests).toEqual([]);
  });
});

describe("usage validation before network work", () => {
  const SPAN = ["--base", "a", "--head", "b"];
  const ANCHOR_FLAGS = ["--file", "f", "--start", "1", "--end", "2"];
  const CREATE_FLAGS = [...ANCHOR_FLAGS, "--body", "b"];

  it.each([
    [["diff", "7", "--json"]],
    [["diff", "7", "--base", "a"]],
    [["diff", "7", "--group", "g", "--base", "a"]],
    [["diff", "7", "--group", "g", "--base", "a", "--head", "b"]],
    [["delta", "7", "--baseline", "a"]],
    [["submit", "7", "--outcome", "comment", "--body", "b", "--base", "a"]],
    [["draft", "delete", "7", "d1", "--head", "b"]],
    [["risk", "address", "7"]],
  ])("%j exits 2 without a request", async (argv) => {
    expectRefusedBeforeRequest(await runCliOffline(argv));
  });

  it.each([
    [["pr", "x"]],
    [["groups", "x"]],
    [["conversation", "x"]],
    [["diff", "x"]],
    [["delta", "x"]],
    [["reply", "c1", "--pr", "x", "--body", "hi"]],
    [["thread", "resolve", "x", "c1"]],
    [["ready", "x"]],
    [["session", "x", ...SPAN]],
    [["marks", "x", "--baseline", "a", "--head", "b"]],
    [["narrative", "x", "--prev-head", "a", "--head", "b"]],
    [["context", "x", ...SPAN]],
    [["submit", "abc", "--outcome", "comment", "--body", "x", ...SPAN]],
    [["draft", "create", "x", ...CREATE_FLAGS, ...SPAN]],
    [["draft", "update", "x", "1", "--body", "b", ...SPAN]],
    [["draft", "reanchor", "x", "1", ...ANCHOR_FLAGS, ...SPAN]],
    [["draft", "delete", "x", "1", ...SPAN]],
    [["chunk-read", "x", "chunk-1", ...SPAN]],
    [["risk", "dismiss", "x", "-F", "-", ...SPAN]],
    [["reclassify", "x", "grp-1", "--category", "bugfix", ...SPAN]],
    [["outcome", "x", "comment", ...SPAN]],
  ])("%j exits 2 naming the PR number, without a request", async (argv) => {
    const result = await runCliOffline(argv, { stdin: '{"flags":[]}' });
    expectRefusedBeforeRequest(result, "PR number");
  });
});
