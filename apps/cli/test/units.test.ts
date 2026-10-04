// Pure-unit coverage for the contract surfaces: the exit-code mapping table
// (additive-only, never renumbered), profile resolution order (locked),
// origin-URL parsing, and the client's proxy/IdP detection.
import { describe, expect, it } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { CLI_VERSION, createApiClient } from "../src/client";
import { runCli } from "../src/program";
import {
  fullNameFromOriginUrl,
  ownerFromOriginUrl,
  resolveProfile,
  type CliConfig,
} from "../src/profile/config";
import { CliError, ExitCodes, exitCodeForStatus } from "../src/exit";

describe("exit-code mapping, the contract table", () => {
  it.each([
    [401, ExitCodes.AUTH],
    [404, ExitCodes.NOT_FOUND],
    [400, ExitCodes.SERVER_REJECTED],
    [403, ExitCodes.SERVER_REJECTED],
    [409, ExitCodes.SERVER_REJECTED],
    [422, ExitCodes.SERVER_REJECTED],
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
      gitRemoteOwner: "octo",
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

function clientWith(response: Response) {
  return createApiClient({
    fetch: async () => response,
    baseUrl: "https://mb.example",
    token: "mergebrief_x",
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

  it("renders a known wire code from the catalog with params", async () => {
    const client = clientWith(
      new Response(
        JSON.stringify({
          error: "MODEL unset",
          code: "generation-config",
          params: { detail: "MODEL unset" },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      client.request({ path: "/api/generate" }),
    ).rejects.toMatchObject({
      message: "MODEL unset (HTTP 503)",
    });
  });

  it("relays verbatim when a parameterized code arrives without params", async () => {
    const client = clientWith(
      new Response(
        JSON.stringify({ error: "MODEL unset", code: "generation-config" }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      client.request({ path: "/api/generate" }),
    ).rejects.toMatchObject({
      // The un-interpolated template must never reach stderr.
      message: "MODEL unset (HTTP 503)",
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

describe("saveConfig permissions", () => {
  it("re-tightens an existing config file to 0600 on rewrite", async () => {
    const { mkdtempSync, statSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { saveConfig } = await import("../src/profile/config");
    const dir = mkdtempSync(join(tmpdir(), "mb-cfg-"));
    // Pre-existing world-readable file (created before the CLI owned it).
    writeFileSync(join(dir, "config.json"), "{}", { mode: 0o644 });
    saveConfig(dir, { profiles: {} });
    expect(statSync(join(dir, "config.json")).mode & 0o777).toBe(0o600);
  });
});

describe("mergebrief --version", () => {
  it("prints the build-time version and exits 0", async () => {
    const out: string[] = [];
    const err: string[] = [];

    const code = await runCli(["--version"], {
      fetch: async () => {
        throw new Error("no request expected");
      },
      env: {},
      configDir: "/nonexistent/config",
      cacheDir: "/nonexistent/cache",
      stdout: (text) => out.push(text),
      stderr: (line) => err.push(line),
      readStdin: async () => "",
      gitOriginUrl: () => undefined,
    });

    expect(code).toBe(0);
    expect(out.join("")).toBe(`${pkg.version}\n`);
    expect(err).toEqual([]);
  });

  it("the repo holds the 0.0.0 dev sentinel", () => {
    expect(pkg.version).toBe("0.0.0");
  });
});
