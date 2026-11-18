import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExitCodes } from "../src/exit";
import { loadConfig, type CliConfig } from "../src/profile/config";
import { BASE_URL } from "./harness/consts";
import {
  expectRefusedBeforeRequest,
  OFFLINE_REPOS_ROUTE,
  OFFLINE_VERSION_ROUTE,
  runCliOffline,
} from "./harness/offline";

const REPOS = ["repos", "--refresh", "--json"];
const WORK_URL = "https://mb.work.example";
const STORED_TOKEN = "mergebrief_stored_secret";
const HEADER_SECRET = "cf-access-secret-value";
const TWO_PROFILES: CliConfig = {
  defaultProfile: "default",
  profiles: {
    default: { baseUrl: BASE_URL, token: STORED_TOKEN },
    work: {
      baseUrl: WORK_URL,
      owners: ["acme"],
      headers: { "CF-Access-Client-Secret": HEADER_SECRET },
    },
  },
};

function readSavedConfig(configDir: string): CliConfig {
  const loaded = loadConfig(configDir);
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  return loaded.value;
}

describe("auth profiles", () => {
  it("lists each profile with no request", async () => {
    const run = await runCliOffline(["auth", "profiles", "--json"], {
      config: TWO_PROFILES,
    });

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.requests).toEqual([]);
    expect(JSON.parse(run.out)).toEqual({
      profiles: [
        {
          name: "default",
          baseUrl: BASE_URL,
          owners: [],
          isDefault: true,
          tokenConfigured: true,
        },
        {
          name: "work",
          baseUrl: WORK_URL,
          owners: ["acme"],
          isDefault: false,
          tokenConfigured: false,
        },
      ],
    });
  });

  it("never prints a stored token or header value", async () => {
    const json = await runCliOffline(["auth", "profiles", "--json"], {
      config: TWO_PROFILES,
    });
    const text = await runCliOffline(["auth", "profiles"], {
      config: TWO_PROFILES,
    });

    for (const secret of [STORED_TOKEN, HEADER_SECRET]) {
      expect(json.out).not.toContain(secret);
      expect(text.out).not.toContain(secret);
    }
  });

  it("marks the only profile as default when the config names none", async () => {
    const run = await runCliOffline(["auth", "profiles", "--json"], {
      config: { profiles: { solo: { baseUrl: BASE_URL } } },
    });

    expect(JSON.parse(run.out)).toMatchObject({
      profiles: [{ name: "solo", isDefault: true }],
    });
  });
});

describe("a request that fails against the resolved profile", () => {
  it.each([
    [401, ExitCodes.AUTH],
    [404, ExitCodes.NOT_FOUND],
    [500, ExitCodes.GENERIC],
  ])(
    "names the other profiles when HTTP %i has server text",
    async (status, code) => {
      const run = await runCliOffline(REPOS, {
        config: TWO_PROFILES,
        routes: [
          {
            method: "GET",
            path: "/api/repos",
            status,
            body: JSON.stringify({ error: "the server's own text" }),
          },
        ],
      });

      expect(run.code).toBe(code);
      expect(run.err).toHaveLength(1);
      expect(run.err[0]).toContain("the server's own text");
      expect(run.err[0]).toMatch(/; other profiles: work$/);
    },
  );

  it.each([[400], [403], [409], [422], [429]])(
    "adds no names when HTTP %i says the instance answered it",
    async (status) => {
      const run = await runCliOffline(REPOS, {
        config: TWO_PROFILES,
        routes: [
          {
            method: "GET",
            path: "/api/repos",
            status,
            body: JSON.stringify({ error: "the server's own text" }),
          },
        ],
      });

      expect(run.err[0]).not.toContain("other profiles");
    },
  );

  it("names the other profiles when the repo is not visible", async () => {
    const run = await runCliOffline(["pr", "7", "--json"], {
      config: TWO_PROFILES,
      routes: [
        {
          method: "GET",
          path: "/api/repos",
          body: JSON.stringify({ repos: [] }),
        },
      ],
    });

    expect(run.code).toBe(ExitCodes.NOT_FOUND);
    expect(run.err).toHaveLength(1);
    expect(run.err[0]).toMatch(/; other profiles: work$/);
  });

  it("names the other profiles on a failure with no server text", async () => {
    const run = await runCliOffline(REPOS, {
      config: TWO_PROFILES,
      routes: [
        { method: "GET", path: "/api/repos", status: 502, body: "bad gateway" },
      ],
    });

    expect(run.code).toBe(ExitCodes.GENERIC);
    expect(run.err).toEqual([
      `request failed (HTTP 502) from ${BASE_URL}, profile default; other profiles: work`,
    ]);
  });

  it("keeps the error on one line when a stored name holds a line break", async () => {
    const run = await runCliOffline(REPOS, {
      config: {
        defaultProfile: "default",
        profiles: {
          default: { baseUrl: BASE_URL },
          "work\nprod": { baseUrl: WORK_URL },
        },
      },
    });

    expect(run.err).toHaveLength(1);
    expect(run.err[0]).not.toContain("\n");
    expect(run.err[0]).toMatch(/; other profiles: work\[U\+000A\]prod$/);
  });

  it("keeps the error on one line when the resolved name holds a line break", async () => {
    const run = await runCliOffline(REPOS, {
      config: {
        profiles: { "work\nprod": { baseUrl: BASE_URL } },
      },
      routes: [{ ...OFFLINE_REPOS_ROUTE, status: 500, body: "not json" }],
    });

    expect(run.err).toEqual([
      `request failed (HTTP 500) from ${BASE_URL}, profile work[U+000A]prod`,
    ]);
  });

  it("keeps the error on one line when the server's text holds an escape", async () => {
    const run = await runCliOffline(REPOS, {
      routes: [
        {
          ...OFFLINE_REPOS_ROUTE,
          status: 409,
          body: JSON.stringify({ error: "first\n\u001b[31msecond" }),
        },
      ],
    });

    expect(run.err).toEqual(["first[U+000A][U+001B][31msecond (HTTP 409)"]);
  });

  it("names the other profiles when the instance cannot be reached", async () => {
    const run = await runCliOffline(REPOS, { config: TWO_PROFILES });

    expect(run.code).toBe(ExitCodes.GENERIC);
    expect(run.err).toHaveLength(1);
    expect(run.err[0]).toContain(`could not reach ${BASE_URL}`);
    expect(run.err[0]).toMatch(/; other profiles: work$/);
  });

  it("names the other profiles when a proxy answers with a page", async () => {
    const run = await runCliOffline(REPOS, {
      config: TWO_PROFILES,
      routes: [
        {
          method: "GET",
          path: "/api/repos",
          status: 200,
          body: "<html></html>",
          headers: { "content-type": "text/html" },
        },
      ],
    });

    expect(run.code).toBe(ExitCodes.GENERIC);
    expect(run.err[0]).toMatch(/; other profiles: work$/);
  });

  it("adds nothing when the config holds one profile", async () => {
    const run = await runCliOffline(REPOS);

    expect(run.err[0]).not.toContain("other profiles");
  });
});

describe("a failure that carries a system error code", () => {
  it("prints its one line and exits generic, not as a silent usage error", async () => {
    const readFailure = Object.assign(new Error("stdin read failed"), {
      code: "EIO",
    });
    const run = await runCliOffline(["auth", "login", "--json"], {
      stdin: readFailure,
    });

    expect(run.code).toBe(ExitCodes.GENERIC);
    expect(run.out).toBe("");
    expect(run.err).toEqual(["stdin read failed"]);
  });
});

describe("auth status beside other profiles", () => {
  const STATUS = ["auth", "status"];

  it("names them when the instance cannot be reached", async () => {
    const run = await runCliOffline(STATUS, { config: TWO_PROFILES });

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.out).toContain("server unreachable; other profiles: work");
  });

  it("names them when the token does not authenticate", async () => {
    const run = await runCliOffline(STATUS, {
      config: TWO_PROFILES,
      routes: [{ ...OFFLINE_VERSION_ROUTE, status: 401 }],
    });

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.out).toContain("NOT authenticated");
    expect(run.out).toContain("other profiles: work");
  });

  it("names them when a pasted token does not authenticate", async () => {
    const run = await runCliOffline(["auth", "login", "--profile", "work"], {
      config: {
        defaultProfile: "default",
        profiles: {
          default: { baseUrl: WORK_URL },
          work: { baseUrl: BASE_URL },
        },
      },
      stdin: "mergebrief_pasted\n",
      routes: [{ ...OFFLINE_VERSION_ROUTE, status: 401 }],
    });

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.out).toContain("NOT authenticated");
    expect(run.out).toContain("other profiles: default");
  });

  it("leaves them out once the token authenticates", async () => {
    const run = await runCliOffline(STATUS, {
      config: TWO_PROFILES,
      routes: [OFFLINE_VERSION_ROUTE],
    });

    expect(run.out).toContain("authenticated");
    expect(run.out).not.toContain("other profiles");
  });

  it("adds no field to the JSON shape", async () => {
    const run = await runCliOffline([...STATUS, "--json"], {
      config: TWO_PROFILES,
    });

    const body: object = JSON.parse(run.out);

    expect(Object.keys(body)).toEqual([
      "profile",
      "baseUrl",
      "tokenConfigured",
      "cli",
      "server",
    ]);
  });
});

describe("auth use", () => {
  it("moves the default so a plain run lands on that profile", async () => {
    const run = await runCliOffline(["auth", "use", "work", "--json"], {
      config: TWO_PROFILES,
    });

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.out).toBe("");
    expect(run.requests).toEqual([]);
    const saved = readSavedConfig(run.configDir);
    expect(saved.defaultProfile).toBe("work");
    expect(saved.profiles["default"]?.token).toBe(STORED_TOKEN);
    expect(saved.profiles["work"]?.headers).toEqual({
      "CF-Access-Client-Secret": HEADER_SECRET,
    });
  });

  it("refuses a profile the config does not hold and writes nothing", async () => {
    const run = await runCliOffline(["auth", "use", "ghost"], {
      config: TWO_PROFILES,
    });

    expectRefusedBeforeRequest(run, 'profile "ghost" is not configured');
    expect(readSavedConfig(run.configDir).defaultProfile).toBe("default");
  });

  it("refuses a name only an object's prototype holds", async () => {
    const run = await runCliOffline(["auth", "use", "constructor"], {
      config: TWO_PROFILES,
    });

    expectRefusedBeforeRequest(run, "is not configured");
    expect(readSavedConfig(run.configDir).defaultProfile).toBe("default");
  });
});

describe("a header value fetch would refuse", () => {
  const BROKEN_TOKEN = "mergebrief_secret\nsecond_line";

  it.each([
    ["a trailing line feed", "mergebrief_secret\n"],
    ["a trailing CRLF", "mergebrief_secret\r\n"],
    ["trailing spaces and tabs", "mergebrief_secret\t "],
  ])("sends a MERGEBRIEF_TOKEN with %s", async (_name, token) => {
    const run = await runCliOffline(REPOS, {
      env: { MERGEBRIEF_TOKEN: token },
      routes: [OFFLINE_REPOS_ROUTE],
    });

    expect(run.err).toEqual([]);
    expect(run.code).toBe(ExitCodes.OK);
  });

  it.each([
    ["an inner line feed", "mergebrief_secret\ntail"],
    ["an inner carriage return", "mergebrief_secret\rtail"],
    ["an inner NUL", "mergebrief_secret\u0000tail"],
    ["a trailing NUL", "mergebrief_secret\u0000"],
    ["a character past Latin-1", "mergebrief_secret…tail"],
  ])("refuses a MERGEBRIEF_TOKEN with %s", async (_name, token) => {
    const run = await runCliOffline(REPOS, {
      env: { MERGEBRIEF_TOKEN: token },
    });

    expectRefusedBeforeRequest(run, "authorization");
    expect(run.err[0]).not.toContain("mergebrief_secret");
  });

  it.each([
    ["a space", "X Client"],
    ["a line break", "X-Client\nSecond"],
  ])("refuses a stored header name holding %s", async (_name, header) => {
    const run = await runCliOffline(REPOS, {
      config: {
        profiles: {
          solo: { baseUrl: BASE_URL, headers: { [header]: "header_secret" } },
        },
      },
    });

    expectRefusedBeforeRequest(run, "header");
    expect(run.err[0]).not.toContain("\n");
    expect(run.err[0]).not.toContain("header_secret");
  });

  it("refuses a stored token and never prints it", async () => {
    const run = await runCliOffline(REPOS, {
      config: {
        profiles: { solo: { baseUrl: BASE_URL, token: BROKEN_TOKEN } },
      },
    });

    expectRefusedBeforeRequest(run, "authorization");
    expect(run.err[0]).not.toContain("mergebrief_secret");
  });

  it("refuses the MERGEBRIEF_TOKEN override and never prints it", async () => {
    const run = await runCliOffline(REPOS, {
      env: { MERGEBRIEF_TOKEN: BROKEN_TOKEN },
    });

    expectRefusedBeforeRequest(run, "authorization");
    expect(run.err[0]).not.toContain("mergebrief_secret");
  });

  it("refuses a stored header and never prints its value", async () => {
    const run = await runCliOffline(REPOS, {
      config: {
        profiles: {
          solo: {
            baseUrl: BASE_URL,
            headers: { "X-Client-Secret": "header_secret\u0000tail" },
          },
        },
      },
    });

    expectRefusedBeforeRequest(run, "X-Client-Secret");
    expect(run.err[0]).not.toContain("header_secret");
  });

  it("surfaces in auth status rather than reading as unreachable", async () => {
    const run = await runCliOffline(["auth", "status", "--json"], {
      env: { MERGEBRIEF_TOKEN: BROKEN_TOKEN },
    });

    expectRefusedBeforeRequest(run, "authorization");
    expect(run.err[0]).not.toContain("mergebrief_secret");
  });
});

describe("auth login over an existing profile", () => {
  const LOGIN_WORK = ["auth", "login", "--profile", "work", "--json"];

  it("logs in to the default profile when nothing names one", async () => {
    const run = await runCliOffline(["auth", "login", "--json"], {
      config: {
        defaultProfile: "work",
        profiles: {
          default: { baseUrl: WORK_URL, token: STORED_TOKEN },
          work: { baseUrl: BASE_URL },
        },
      },
      stdin: "mergebrief_pasted\n",
      routes: [OFFLINE_VERSION_ROUTE],
    });

    expect(run.code).toBe(ExitCodes.OK);
    const saved = readSavedConfig(run.configDir).profiles;
    expect(saved["work"]?.token).toBe("mergebrief_pasted");
    expect(saved["default"]?.token).toBe(STORED_TOKEN);
  });

  const ROUTED_AWAY: CliConfig = {
    defaultProfile: "work",
    profiles: {
      work: { baseUrl: WORK_URL, token: STORED_TOKEN },
      octo: { baseUrl: BASE_URL, owners: ["octo"] },
    },
  };

  it("refuses when the clone's owner routes away from the default", async () => {
    const run = await runCliOffline(["auth", "login", "--json"], {
      config: ROUTED_AWAY,
      stdin: "mergebrief_pasted\n",
    });

    expectRefusedBeforeRequest(run, "--profile");
    expect(run.err[0]).toContain('"octo"');
    const saved = readSavedConfig(run.configDir).profiles;
    expect(saved["octo"]?.token).toBeUndefined();
    expect(saved["work"]?.token).toBe(STORED_TOKEN);
  });

  it("refuses an owner's route when the config names no default", async () => {
    const run = await runCliOffline(["auth", "login", "--json"], {
      config: {
        profiles: {
          default: { baseUrl: BASE_URL, owners: ["octo"] },
          work: { baseUrl: WORK_URL },
        },
      },
      stdin: "mergebrief_pasted\n",
    });

    expectRefusedBeforeRequest(run, '"default"');
    const saved = readSavedConfig(run.configDir).profiles;
    expect(saved["default"]?.token).toBeUndefined();
  });

  it("lets --profile settle a route that differs from the default", async () => {
    const run = await runCliOffline(
      ["auth", "login", "--profile", "octo", "--json"],
      {
        config: ROUTED_AWAY,
        stdin: "mergebrief_pasted\n",
        routes: [OFFLINE_VERSION_ROUTE],
      },
    );

    expect(run.code).toBe(ExitCodes.OK);
    const saved = readSavedConfig(run.configDir).profiles;
    expect(saved["octo"]?.token).toBe("mergebrief_pasted");
  });

  it("logs in when the owner routes to the default itself", async () => {
    const run = await runCliOffline(["auth", "login", "--json"], {
      config: {
        defaultProfile: "work",
        profiles: { work: { baseUrl: BASE_URL, owners: ["octo"] } },
      },
      stdin: "mergebrief_pasted\n",
      routes: [OFFLINE_VERSION_ROUTE],
    });

    expect(run.code).toBe(ExitCodes.OK);
    const saved = readSavedConfig(run.configDir).profiles;
    expect(saved["work"]?.token).toBe("mergebrief_pasted");
  });

  it("drops stored headers and owners when --base-url changes origin", async () => {
    const run = await runCliOffline([...LOGIN_WORK, "--base-url", BASE_URL], {
      config: TWO_PROFILES,
      stdin: "mergebrief_pasted\n",
      routes: [OFFLINE_VERSION_ROUTE],
    });

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.requests[0]?.headers).not.toHaveProperty(
      "CF-Access-Client-Secret",
    );
    const saved = readSavedConfig(run.configDir).profiles["work"];
    expect(saved?.headers).toBeUndefined();
    expect(saved?.owners).toBeUndefined();
  });

  it("keeps stored headers and owners on the same origin", async () => {
    const run = await runCliOffline(LOGIN_WORK, {
      config: {
        profiles: {
          work: {
            baseUrl: BASE_URL,
            owners: ["acme"],
            headers: { "CF-Access-Client-Secret": HEADER_SECRET },
          },
        },
      },
      stdin: "mergebrief_pasted\n",
      routes: [OFFLINE_VERSION_ROUTE],
    });

    expect(run.code).toBe(ExitCodes.OK);
    const saved = readSavedConfig(run.configDir).profiles["work"];
    expect(saved?.headers).toEqual({
      "CF-Access-Client-Secret": HEADER_SECRET,
    });
    expect(saved?.owners).toEqual(["acme"]);
  });

  it("keeps stored headers when --base-url moves within the origin", async () => {
    const run = await runCliOffline(
      [...LOGIN_WORK, "--base-url", `${BASE_URL}/mergebrief`],
      {
        config: {
          profiles: {
            work: {
              baseUrl: BASE_URL,
              headers: { "CF-Access-Client-Secret": HEADER_SECRET },
            },
          },
        },
        stdin: "mergebrief_pasted\n",
        routes: [OFFLINE_VERSION_ROUTE],
      },
    );

    expect(run.code).toBe(ExitCodes.OK);
    const saved = readSavedConfig(run.configDir).profiles["work"];
    expect(saved?.baseUrl).toBe(`${BASE_URL}/mergebrief`);
    expect(saved?.headers).toEqual({
      "CF-Access-Client-Secret": HEADER_SECRET,
    });
  });

  it("refuses a profile name holding a line break", async () => {
    const run = await runCliOffline(
      ["auth", "login", "--profile", "work\nprod", "--base-url", BASE_URL],
      { config: TWO_PROFILES, stdin: "mergebrief_pasted\n" },
    );

    expectRefusedBeforeRequest(run, "can't be named");
    expect(run.err[0]).not.toContain("\n");
    const saved = readSavedConfig(run.configDir).profiles;
    expect(Object.keys(saved)).toEqual(["default", "work"]);
  });

  it.each([["../.."], ["a/b"], ["a\\b"], [".."], ["."], [""]])(
    "refuses the profile name %j, which would leave its cache folder",
    async (name) => {
      const run = await runCliOffline(
        ["auth", "login", "--profile", name, "--base-url", BASE_URL],
        { config: TWO_PROFILES, stdin: "mergebrief_pasted\n" },
      );

      expectRefusedBeforeRequest(run, "can't be named");
      const saved = readSavedConfig(run.configDir).profiles;
      expect(Object.keys(saved)).toEqual(["default", "work"]);
    },
  );

  it("treats a name only an object's prototype holds as a new profile", async () => {
    const run = await runCliOffline(
      [
        "auth",
        "login",
        "--profile",
        "constructor",
        "--base-url",
        BASE_URL,
        "--json",
      ],
      {
        config: TWO_PROFILES,
        stdin: "mergebrief_pasted\n",
        routes: [OFFLINE_VERSION_ROUTE],
      },
    );

    expect(run.code).toBe(ExitCodes.OK);
    const saved = readSavedConfig(run.configDir).profiles["constructor"];
    expect(saved?.baseUrl).toBe(BASE_URL);
  });

  it("refuses a profile named __proto__, which the next load would drop", async () => {
    const run = await runCliOffline(
      ["auth", "login", "--profile", "__proto__", "--base-url", BASE_URL],
      { config: TWO_PROFILES, stdin: "mergebrief_pasted\n" },
    );

    expectRefusedBeforeRequest(run, "__proto__");
  });

  it("refuses a --base-url that would make the config unloadable", async () => {
    const run = await runCliOffline(
      [...LOGIN_WORK, "--base-url", "not a url"],
      {
        config: TWO_PROFILES,
        stdin: "mergebrief_pasted\n",
      },
    );

    expectRefusedBeforeRequest(run, "--base-url");
    expect(readSavedConfig(run.configDir).profiles["work"]?.baseUrl).toBe(
      WORK_URL,
    );
  });

  it.each([
    ["an inner line break", "mergebrief_secret\nsecond_line\n"],
    ["a character past Latin-1", "mergebrief_secret…tail\n"],
  ])("refuses a token with %s and stores nothing", async (_name, stdin) => {
    const run = await runCliOffline(LOGIN_WORK, {
      config: TWO_PROFILES,
      stdin,
    });

    expectRefusedBeforeRequest(run);
    expect(run.err[0]).not.toContain("mergebrief_secret");
    expect(readSavedConfig(run.configDir).profiles["work"]?.token).toBe(
      undefined,
    );
  });
});

describe("auth owners", () => {
  it("routes an owner to the profile --profile names", async () => {
    const run = await runCliOffline(
      ["auth", "owners", "octo", "--profile", "work", "--json"],
      { config: TWO_PROFILES },
    );

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.out).toBe("");
    expect(readSavedConfig(run.configDir).profiles["work"]?.owners).toEqual([
      "octo",
    ]);
  });

  it("never stores the MERGEBRIEF_TOKEN override", async () => {
    const run = await runCliOffline(
      ["auth", "owners", "octo", "--profile", "default"],
      {
        config: TWO_PROFILES,
        env: { MERGEBRIEF_TOKEN: "mergebrief_from_env" },
      },
    );

    const saved = readSavedConfig(run.configDir);
    expect(saved.profiles["default"]?.token).toBe(STORED_TOKEN);
  });

  it("clears a profile's owners with --clear", async () => {
    const run = await runCliOffline(
      ["auth", "owners", "--clear", "--profile", "work"],
      { config: TWO_PROFILES },
    );

    expect(run.code).toBe(ExitCodes.OK);
    expect(readSavedConfig(run.configDir).profiles["work"]?.owners).toEqual([]);
  });

  it("refuses an owner another profile already routes", async () => {
    const run = await runCliOffline(["auth", "owners", "ACME"], {
      config: TWO_PROFILES,
    });

    expectRefusedBeforeRequest(run, 'owner "ACME" already routes to "work"');
    expect(readSavedConfig(run.configDir).profiles["default"]?.owners).toBe(
      undefined,
    );
  });

  it("refuses a profile name only an object's prototype holds", async () => {
    const run = await runCliOffline(
      ["auth", "owners", "octo", "--profile", "constructor"],
      { config: TWO_PROFILES },
    );

    expectRefusedBeforeRequest(run, "is not configured");
    expect(readSavedConfig(run.configDir).defaultProfile).toBe("default");
  });

  it("refuses a default profile only an object's prototype holds", async () => {
    const run = await runCliOffline(["auth", "owners", "octo"], {
      config: {
        defaultProfile: "constructor",
        profiles: { work: { baseUrl: WORK_URL } },
      },
    });

    expectRefusedBeforeRequest(run, "no profile resolved");
  });

  it("refuses a blank owner so the config stays loadable", async () => {
    const run = await runCliOffline(["auth", "owners", ""], {
      config: TWO_PROFILES,
    });

    expectRefusedBeforeRequest(run, "owner");
    expect(readSavedConfig(run.configDir).profiles["default"]?.owners).toBe(
      undefined,
    );
  });

  it.each([["acme,octo"], ["acme/hello"], [" acme"], ["acme\nocto"]])(
    "refuses %j, which no clone's owner can match",
    async (owner) => {
      const run = await runCliOffline(["auth", "owners", owner], {
        config: TWO_PROFILES,
      });

      expectRefusedBeforeRequest(run, "GitHub owner");
      expect(run.err[0]).not.toContain("\n");
      expect(readSavedConfig(run.configDir).profiles["default"]?.owners).toBe(
        undefined,
      );
    },
  );

  it("accepts an enterprise-managed owner with an underscore", async () => {
    const run = await runCliOffline(["auth", "owners", "octo_corp"], {
      config: TWO_PROFILES,
    });

    expect(run.code).toBe(ExitCodes.OK);
    expect(readSavedConfig(run.configDir).profiles["default"]?.owners).toEqual([
      "octo_corp",
    ]);
  });

  it("refuses no owners and no --clear", async () => {
    const run = await runCliOffline(["auth", "owners"], {
      config: TWO_PROFILES,
    });

    expectRefusedBeforeRequest(run, "--clear");
  });

  it("refuses owners named together with --clear", async () => {
    const run = await runCliOffline(["auth", "owners", "octo", "--clear"], {
      config: TWO_PROFILES,
    });

    expectRefusedBeforeRequest(run, "--clear");
    expect(readSavedConfig(run.configDir).profiles["default"]?.owners).toBe(
      undefined,
    );
  });

  it("matches the origin owner without regard to case", async () => {
    const run = await runCliOffline(["auth", "status", "--json"], {
      config: {
        defaultProfile: "default",
        profiles: {
          default: { baseUrl: BASE_URL },
          work: { baseUrl: BASE_URL, owners: ["OCTO"], token: STORED_TOKEN },
        },
      },
      routes: [{ method: "GET", path: "/api/version", body: "{}" }],
    });

    expect(JSON.parse(run.out)).toMatchObject({ profile: "work" });
  });
});

describe("MERGEBRIEF_TOKEN when the clone's owner routes away from the default", () => {
  const ENV_TOKEN = "mergebrief_from_env";
  const ROUTED_AWAY: CliConfig = {
    defaultProfile: "work",
    profiles: {
      work: { baseUrl: WORK_URL },
      octo: { baseUrl: BASE_URL, owners: ["octo"], token: STORED_TOKEN },
    },
  };

  it("refuses rather than send the token where the origin points", async () => {
    const run = await runCliOffline(REPOS, {
      config: ROUTED_AWAY,
      env: { MERGEBRIEF_TOKEN: ENV_TOKEN },
    });

    expectRefusedBeforeRequest(run, "MERGEBRIEF_TOKEN");
    expect(run.err[0]).toContain('"octo"');
    expect(run.err[0]).not.toContain(ENV_TOKEN);
  });

  it("refuses auth status, which the skill's preflight reads as exit 2", async () => {
    const run = await runCliOffline(["auth", "status", "--json"], {
      config: ROUTED_AWAY,
      env: { MERGEBRIEF_TOKEN: ENV_TOKEN },
    });

    expectRefusedBeforeRequest(run, "MERGEBRIEF_TOKEN");
    expect(run.err[0]).not.toContain(ENV_TOKEN);
  });

  it.each([
    ["--profile", ["--profile", "octo"], {}],
    ["MERGEBRIEF_PROFILE", [], { MERGEBRIEF_PROFILE: "octo" }],
  ])("%s settles which instance gets it", async (_name, flags, env) => {
    const run = await runCliOffline([...REPOS, ...flags], {
      config: ROUTED_AWAY,
      env: { MERGEBRIEF_TOKEN: ENV_TOKEN, ...env },
      routes: [OFFLINE_REPOS_ROUTE],
    });

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.requests[0]?.headers).toMatchObject({
      authorization: `Bearer ${ENV_TOKEN}`,
    });
  });

  it("sends it when the owner routes to the default itself", async () => {
    const run = await runCliOffline(REPOS, {
      config: {
        defaultProfile: "octo",
        profiles: { octo: { baseUrl: BASE_URL, owners: ["octo"] } },
      },
      env: { MERGEBRIEF_TOKEN: ENV_TOKEN },
      routes: [OFFLINE_REPOS_ROUTE],
    });

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.requests[0]?.headers).toMatchObject({
      authorization: `Bearer ${ENV_TOKEN}`,
    });
  });

  it.each([
    ["sets", ["auth", "owners", "octo", "acme"], ["octo", "acme"]],
    ["clears", ["auth", "owners", "--clear"], []],
  ])("still %s owners, which sends no token", async (_verb, argv, owners) => {
    const run = await runCliOffline(argv, {
      config: ROUTED_AWAY,
      env: { MERGEBRIEF_TOKEN: ENV_TOKEN },
    });

    expect(run.err).toEqual([]);
    expect(run.code).toBe(ExitCodes.OK);
    expect(run.requests).toEqual([]);
    const saved = readSavedConfig(run.configDir).profiles["octo"];
    expect(saved?.owners).toEqual(owners);
    expect(saved?.token).toBe(STORED_TOKEN);
  });

  it("still routes a stored token by owner", async () => {
    const run = await runCliOffline(REPOS, {
      config: ROUTED_AWAY,
      routes: [OFFLINE_REPOS_ROUTE],
    });

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.requests[0]?.headers).toMatchObject({
      authorization: `Bearer ${STORED_TOKEN}`,
    });
  });
});

describe("the repo cache across an auth login", () => {
  const STALE_CACHE = JSON.stringify({
    repos: [{ repoId: "1", fullName: "octo/hello" }],
  });

  function hasRepoCache(cacheDir: string, profile: string): boolean {
    return existsSync(join(cacheDir, profile, "repos.json"));
  }

  it("drops the old instance's list when the origin changes", async () => {
    const run = await runCliOffline(
      ["auth", "login", "--profile", "work", "--base-url", BASE_URL, "--json"],
      {
        config: TWO_PROFILES,
        stdin: "mergebrief_pasted\n",
        routes: [OFFLINE_VERSION_ROUTE],
        repoCaches: { work: STALE_CACHE, default: STALE_CACHE },
      },
    );

    expect(run.code).toBe(ExitCodes.OK);
    expect(hasRepoCache(run.cacheDir, "work")).toBe(false);
    expect(hasRepoCache(run.cacheDir, "default")).toBe(true);
  });

  it("stores nothing and says why when the old list can't be deleted", async () => {
    const run = await runCliOffline(
      ["auth", "login", "--profile", "work", "--base-url", BASE_URL, "--json"],
      {
        config: TWO_PROFILES,
        stdin: "mergebrief_pasted\n",
        undeletableRepoCaches: ["work"],
      },
    );

    expect(run.code).toBe(ExitCodes.GENERIC);
    expect(run.out).toBe("");
    expect(run.err).toHaveLength(1);
    expect(run.err[0]).toContain("repos.json");
    const saved = readSavedConfig(run.configDir).profiles["work"];
    expect(saved?.baseUrl).toBe(WORK_URL);
    expect(saved?.token).toBeUndefined();
  });

  it("keeps the list on the same origin", async () => {
    const run = await runCliOffline(
      ["auth", "login", "--profile", "default", "--json"],
      {
        config: TWO_PROFILES,
        stdin: "mergebrief_pasted\n",
        routes: [OFFLINE_VERSION_ROUTE],
        repoCaches: { default: STALE_CACHE },
      },
    );

    expect(run.code).toBe(ExitCodes.OK);
    expect(hasRepoCache(run.cacheDir, "default")).toBe(true);
  });
});
