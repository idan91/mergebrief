// Pure-unit coverage for the contract surfaces: the 6-code exit mapping table
// (additive-only, never renumbered), profile resolution order (locked),
// origin-URL parsing, and the client's proxy/IdP detection.
import { describe, expect, it } from "vitest";
import { createApiClient } from "../src/client";
import {
  fullNameFromOriginUrl,
  ownerFromOriginUrl,
  resolveProfile,
  type CliConfig,
} from "../src/profile/config";
import { CliError, ExitCode, exitCodeForStatus } from "../src/exit";

describe("exit-code mapping (the contract table)", () => {
  it.each([
    [401, ExitCode.AUTH],
    [404, ExitCode.NOT_FOUND],
    [400, ExitCode.SERVER_REJECTED],
    [403, ExitCode.SERVER_REJECTED],
    [409, ExitCode.SERVER_REJECTED],
    [422, ExitCode.SERVER_REJECTED],
    [500, ExitCode.GENERIC],
    [502, ExitCode.GENERIC],
    [503, ExitCode.GENERIC],
  ])("HTTP %i → exit %i", (status, code) => {
    expect(exitCodeForStatus(status)).toBe(code);
  });

  it("pins the numeric values — additive-only, never renumbered", () => {
    expect(ExitCode).toEqual({
      OK: 0,
      GENERIC: 1,
      USAGE: 2,
      AUTH: 3,
      NOT_FOUND: 4,
      SERVER_REJECTED: 5,
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
      ExitCode.USAGE,
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
      code: ExitCode.GENERIC,
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
      code: ExitCode.GENERIC,
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
      code: ExitCode.AUTH,
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
