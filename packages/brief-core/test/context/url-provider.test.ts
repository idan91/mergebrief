import type { LookupAddress } from "node:dns";
import http, { Agent as HttpAgent, createServer } from "node:http";
import https, { Agent as HttpsAgent } from "node:https";
import {
  createConnection,
  type AddressInfo,
  type LookupFunction,
} from "node:net";
import { describe, expect, it } from "vitest";
import {
  createUrlContextProvider,
  createValidatingLookup,
  extractLinks,
  isPublicUrl,
  type AddressResolver,
} from "../../src/context/providers/url";
import {
  ContextProviderTypes,
  type ContextQuery,
} from "../../src/context/types";

function makeQuery(body: string): ContextQuery {
  return {
    title: "t",
    body,
    headRef: "",
    repo: { owner: "o", repo: "r" },
    trackers: [],
    references: [],
  };
}

function stubDeps(logs: string[] = []) {
  return {
    log: (m: string) => logs.push(m),
    signal: new AbortController().signal,
  };
}

function stubResolver(
  addresses: LookupAddress[],
  asked: string[] = [],
): AddressResolver {
  return (hostname, callback) => {
    asked.push(hostname);
    setImmediate(() => callback(null, addresses));
  };
}

interface ConnectionOutcome {
  readonly attempted?: string;
  readonly errorCode?: string;
}

function attemptConnection(
  lookup: LookupFunction,
  autoSelectFamily: boolean,
): Promise<ConnectionOutcome> {
  return new Promise((resolve) => {
    const socket = createConnection({
      host: "docs.example",
      port: 80,
      lookup,
      autoSelectFamily,
    });
    socket.on("connectionAttempt", (address: string) => {
      resolve({ attempted: address });
    });
    // Destroying inside the attempt event crashes node's single-address path.
    socket.on("connectionAttempt", () => {
      setImmediate(() => socket.destroy());
    });
    socket.on("error", (error: NodeJS.ErrnoException) => {
      resolve({ errorCode: error.code ?? "" });
    });
  });
}

async function listenOnLoopback(requests: string[]) {
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    response.end("internal");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { server, port };
}

// A forward proxy: plain requests for http, CONNECT tunnels for https.
async function listenAsProxy(proxied: string[]) {
  const listener = await listenOnLoopback(proxied);
  listener.server.on("connect", (request, socket) => {
    proxied.push(request.url ?? "");
    socket.destroy();
  });
  return listener;
}

const PUBLIC_RECORD = { address: "93.184.215.14", family: 4 };
const LOOPBACK_RECORD = { address: "127.0.0.1", family: 4 };
const MAPPED_LOOPBACK_RECORD = { address: "::ffff:7f00:1", family: 6 };

describe("isPublicUrl, the SSRF pre-filter", () => {
  // No DNS: an IP literal is checked only here, a name again at connect time.
  it.each([
    "http://localhost:6006/", // loopback by name
    "http://127.0.0.1/admin", // loopback IP
    "http://[::1]/", // loopback IPv6
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://10.0.0.1/", // private
    "http://192.168.1.1/", // private
    "http://172.16.0.1/", // private
    "http://service.local/", // mDNS
    "file:///etc/passwd", // non-http scheme
    "http://user:pass@example.com/", // embedded credentials
    "not a url", // malformed
  ])("blocks %s", (url) => {
    expect(isPublicUrl(url)).toBe(false);
  });

  it.each([
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[0:0:0:0:0:ffff:7f00:1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[::ffff:a9fe:a9fe]/",
    "http://[0:0:0:0:0:ffff:a9fe:a9fe]/",
    "http://[::ffff:a00:1]/",
  ])("blocks the IPv4-mapped private address %s", (url) => {
    expect(isPublicUrl(url)).toBe(false);
  });

  it.each([
    "http://[::127.0.0.1]/",
    "http://[::7f00:1]/",
    "http://[::a9fe:a9fe]/",
  ])("blocks the IPv4-compatible address %s", (url) => {
    expect(isPublicUrl(url)).toBe(false);
  });

  it.each([
    "http://100.64.0.1/",
    "http://100.127.255.254/",
    "http://198.18.0.1/",
    "http://198.19.255.254/",
    "http://192.0.0.8/",
    "http://240.0.0.1/",
    "http://255.255.255.255/",
    "http://0.0.0.0/",
    "http://[fec0::1]/",
    "http://[febf::1]/",
    "http://[64:ff9b::7f00:1]/",
  ])("blocks the reserved-range address %s", (url) => {
    expect(isPublicUrl(url)).toBe(false);
  });

  it("blocks the Azure WireServer address", () => {
    expect(isPublicUrl("http://168.63.129.16/machine")).toBe(false);
  });

  it.each([
    "http://0x7f.1/",
    "http://2130706433/",
    "http://127.1/",
    "http://0177.0.0.1/",
    "http://[fe80::1%25eth0]/",
  ])("blocks the loopback shorthand or zoned literal %s", (url) => {
    expect(isPublicUrl(url)).toBe(false);
  });

  it.each([
    "https://example.com/docs/a.md",
    "https://100.63.255.255/",
    "https://100.128.0.1/",
    "https://198.20.0.1/",
    "https://[2606:4700::1]/",
    "https://[::ffff:8.8.8.8]/",
  ])("allows the public URL %s", (url) => {
    expect(isPublicUrl(url)).toBe(true);
  });
});

describe("extractLinks", () => {
  it("dedupes, trims trailing punctuation and caps at five", () => {
    const body = [
      "see https://a.example/one.",
      "and https://a.example/one, again",
      "https://a.example/two; https://a.example/three",
      "https://a.example/four https://a.example/five https://a.example/six",
    ].join("\n");
    expect(extractLinks(body)).toEqual([
      "https://a.example/one",
      "https://a.example/two",
      "https://a.example/three",
      "https://a.example/four",
      "https://a.example/five",
    ]);
  });
});

describe("the URL context provider", () => {
  const provider = createUrlContextProvider();

  it("is the URL provider and skips a blocked link without failing", async () => {
    const logs: string[] = [];
    expect(provider.providerId).toBe(ContextProviderTypes.URL);

    const outcome = await provider.fetch(
      makeQuery("internal: http://127.0.0.1/admin"),
      stubDeps(logs),
    );

    expect(outcome).toEqual({ ok: true, value: [] });
    expect(logs.some((l) => l.includes("blocked"))).toBe(true);
  });

  it("skips the primary ticket's URL so it is never fetched twice", async () => {
    const logs: string[] = [];
    const url = "http://127.0.0.1/issues/1";
    const outcome = await provider.fetch(
      {
        ...makeQuery(`see ${url}`),
        primary: {
          tracker: "github",
          key: "",
          number: 1,
          url,
          foundIn: "description",
          closing: false,
        },
      },
      stubDeps(logs),
    );
    expect(outcome).toEqual({ ok: true, value: [] });
    expect(logs).toEqual([]);
  });

  it("skips the primary's URL in any of its forms", async () => {
    const logs: string[] = [];
    const body =
      "https://github.com/o/r/issues/9/ https://github.com/o/r/issues/9?x=1 https://github.com/o/r/issues/9#issuecomment-2";
    const outcome = await provider.fetch(
      {
        ...makeQuery(body),
        primary: {
          tracker: "github",
          key: "",
          number: 9,
          url: "https://github.com/o/r/issues/9",
          foundIn: "description",
          closing: false,
        },
      },
      stubDeps(logs),
    );
    expect(outcome).toEqual({ ok: true, value: [] });
    expect(logs).toEqual([]);
  });

  it("returns nothing for a body with no links", async () => {
    const outcome = await provider.fetch(makeQuery("plain"), stubDeps());
    expect(outcome).toEqual({ ok: true, value: [] });
  });

  it.each([
    ["resolves to loopback", [LOOPBACK_RECORD]],
    ["has public and loopback records", [PUBLIC_RECORD, LOOPBACK_RECORD]],
    ["has a mapped loopback record", [MAPPED_LOOPBACK_RECORD]],
  ])("never connects to a named link that %s", async (_, records) => {
    const requests: string[] = [];
    const logs: string[] = [];
    const { server, port } = await listenOnLoopback(requests);
    const guarded = createUrlContextProvider({
      resolveAddresses: stubResolver(records),
    });

    const outcome = await guarded.fetch(
      makeQuery(`see http://docs.example:${port}/internal`),
      stubDeps(logs),
    );
    server.close();

    expect(outcome).toEqual({ ok: true, value: [] });
    expect(requests).toEqual([]);
    expect(logs.some((line) => line.includes("private address"))).toBe(true);
  });

  it.each(["http", "https"])(
    "sends a %s link past a proxied global agent to the lookup",
    async (scheme) => {
      const proxied: string[] = [];
      const asked: string[] = [];
      const { server: proxy, port } = await listenAsProxy(proxied);
      const proxyUrl = `http://127.0.0.1:${port}`;
      // What NODE_USE_ENV_PROXY=1 installs at startup, read from HTTP(S)_PROXY.
      const proxyOptions = {
        keepAlive: false,
        proxyEnv: { HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl },
      };
      const globalAgents = {
        http: http.globalAgent,
        https: https.globalAgent,
      };
      http.globalAgent = new HttpAgent(proxyOptions);
      https.globalAgent = new HttpsAgent(proxyOptions);
      const guarded = createUrlContextProvider({
        resolveAddresses: stubResolver([LOOPBACK_RECORD], asked),
      });

      try {
        const outcome = await guarded.fetch(
          makeQuery(`see ${scheme}://docs.example/internal`),
          stubDeps(),
        );
        expect(outcome).toEqual({ ok: true, value: [] });
      } finally {
        http.globalAgent = globalAgents.http;
        https.globalAgent = globalAgents.https;
        proxy.close();
      }

      expect(proxied).toEqual([]);
      expect(asked).toEqual(["docs.example"]);
    },
  );
});

describe("createValidatingLookup, the connect-time check", () => {
  it.each([
    ["every record", true],
    ["one record", false],
  ])(
    "connects to the checked address when node asks for %s",
    async (_, all) => {
      const lookup = createValidatingLookup(stubResolver([PUBLIC_RECORD]));
      const outcome = await attemptConnection(lookup, all);
      expect(outcome).toEqual({ attempted: PUBLIC_RECORD.address });
    },
  );

  it.each([
    ["every record", true],
    ["one record", false],
  ])(
    "refuses a public and blocked mix when node asks for %s",
    async (_, all) => {
      const lookup = createValidatingLookup(
        stubResolver([PUBLIC_RECORD, LOOPBACK_RECORD]),
      );
      const outcome = await attemptConnection(lookup, all);
      expect(outcome).toEqual({ errorCode: "ESSRFBLOCKED" });
    },
  );
});
