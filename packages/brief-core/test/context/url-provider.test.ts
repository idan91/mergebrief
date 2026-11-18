import type { LookupAddress } from "node:dns";
import http, { Agent as HttpAgent, createServer } from "node:http";
import https, { Agent as HttpsAgent } from "node:https";
import {
  createConnection,
  type AddressInfo,
  type LookupFunction,
} from "node:net";
import { gzipSync } from "node:zlib";
import {
  DEFAULT_LINK_FETCH,
  LinkFetchModes,
  type LinkFetchPolicy,
} from "generators";
import type { Mutable } from "types/utils";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createBuiltInContextProviders } from "../../src/context/registry";
import {
  createUrlContextProvider,
  extractLinks,
  fitLinkedTextBudget,
} from "../../src/context/providers/url";
import {
  DNS_CANCEL_MARGIN_MS,
  LINK_LOOKUP_BOUNDS,
} from "../../src/context/providers/url/consts";
import {
  boundAddressResolver,
  createValidatingLookup,
  isPublicUrl,
  queryAllAddresses,
} from "../../src/context/providers/url/guard";
import {
  fetchText,
  MAX_PAGE_CHARS,
} from "../../src/context/providers/url/fetch-text";
import { removeUnshownElements } from "../../src/context/providers/url/page-text";
import type {
  AddressResolver,
  DnsRecordResolver,
  UrlContextProviderOptions,
} from "../../src/context/providers/url/types";
import {
  ContextProviderTypes,
  MAX_SNIPPET_CHARS,
  type ContextQuery,
  type ProviderSnippet,
} from "../../src/context/types";
import { LINEAR_GROWTH_CEILING, measureGrowthRatio } from "../growth-ratio";
import { JIRA_ISSUE_URL, JIRA_SITE, JIRA_TRACKER } from "./helpers";

// The real reader by default; the guard refuses every loopback test server.
vi.mock(
  "../../src/context/providers/url/fetch-text",
  async (importOriginal) => {
    const actual = await importOriginal<{ fetchText: typeof fetchText }>();
    return { ...actual, fetchText: vi.fn(actual.fetchText) };
  },
);

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

  it.each([
    "http://[2002:7f00:1::1]/",
    "http://[2001::1]/",
    "http://[2001:0:4136:e378::1]/",
    "http://[2001:1ff::1]/",
    "http://[3fff::1]/",
    "http://[2001:db8::1]/",
    "http://[5f00::1]/",
    "http://[100::1]/",
    "http://[ff02::1]/",
    "http://[::ffff:0:7f00:1]/",
    "http://[::ffff:0:a9fe:a9fe]/",
    "http://224.0.0.1/",
    "http://239.255.255.250/",
    "http://192.88.99.1/",
    "http://192.0.2.1/",
    "http://198.51.100.1/",
    "http://203.0.113.1/",
  ])("blocks the special-purpose address %s", (url) => {
    expect(isPublicUrl(url)).toBe(false);
  });

  it.each([
    "https://example.com:8443/",
    "http://example.com:6379/",
    "https://example.com:22/",
    "http://example.com:0/",
  ])("blocks the non-default port in %s", (url) => {
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
    "https://example.com:443/",
    "http://example.com:80/",
    "http://example.com:443/",
    "https://[2001:200::1]/",
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

  it.each([
    ["strong emphasis", "Fixes **https://a.example/one**"],
    ["underscore emphasis", "Fixes _https://a.example/one_"],
    ["strikethrough", "Fixes ~https://a.example/one~"],
    ["emphasis after a period", "see *https://a.example/one.*"],
  ])("trims the closing delimiters of %s", (_shape, body) => {
    expect(extractLinks(body)).toEqual(["https://a.example/one"]);
  });
});

describe("the URL context provider", () => {
  const provider = createUrlContextProvider({
    linkFetch: DEFAULT_LINK_FETCH,
  });

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

  describe("with a jira primary", () => {
    const JIRA_QUERY = {
      trackers: [JIRA_TRACKER],
      jiraSite: JIRA_SITE,
      primary: {
        tracker: "jira" as const,
        key: "ACME-12",
        url: JIRA_ISSUE_URL,
        foundIn: "description" as const,
        closing: false,
      },
    };

    /** The links the chaser asked for, each answered with a page and no network. */
    async function chaseLinks(query: ContextQuery): Promise<string[]> {
      const asked: string[] = [];
      vi.mocked(fetchText).mockImplementation(async (url) => {
        asked.push(url);
        return { text: "page" };
      });
      try {
        await provider.fetch(query, stubDeps());
      } finally {
        vi.mocked(fetchText).mockReset();
      }
      return asked;
    }

    it("skips the primary's jira link in every form it counts in", async () => {
      const body = [
        `${JIRA_ISSUE_URL}?filter=123`,
        "https://jira.acme.com/browse/acme-12",
        "https://acme.atlassian.net/jira/software/projects/ACME/boards/1?selectedIssue=ACME-12",
        "https://JIRA.acme.com/servicedesk/customer/portal/3/ACME-12.",
      ].join("\n");

      const asked = await chaseLinks({ ...makeQuery(body), ...JIRA_QUERY });

      expect(asked).toEqual([]);
    });

    it("still chases a link that is not the primary's", async () => {
      const body = `${JIRA_ISSUE_URL} https://docs.example/spec https://acme.atlassian.net/browse/WEB-3`;

      const asked = await chaseLinks({ ...makeQuery(body), ...JIRA_QUERY });

      expect(asked).toEqual([
        "https://docs.example/spec",
        "https://acme.atlassian.net/browse/WEB-3",
      ]);
    });

    it("chases a jira link when the query names no jira site", async () => {
      const body = `https://jira.acme.com/browse/ACME-12 ${JIRA_ISSUE_URL}`;

      const asked = await chaseLinks({
        ...makeQuery(body),
        trackers: JIRA_QUERY.trackers,
        primary: JIRA_QUERY.primary,
      });

      expect(asked).toEqual(["https://jira.acme.com/browse/ACME-12"]);
    });
  });

  it("refuses a non-web port before any lookup", async () => {
    const asked: string[] = [];
    const logs: string[] = [];
    const guarded = createUrlContextProvider({
      linkFetch: DEFAULT_LINK_FETCH,
      resolveAddresses: stubResolver([PUBLIC_RECORD], asked),
    });

    const outcome = await guarded.fetch(
      makeQuery("see http://docs.example:6379/"),
      stubDeps(logs),
    );

    expect(outcome).toEqual({ ok: true, value: [] });
    expect(asked).toEqual([]);
    expect(logs.some((line) => line.includes("blocked"))).toBe(true);
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
      linkFetch: DEFAULT_LINK_FETCH,
      resolveAddresses: stubResolver(records),
      allowedPorts: new Set([port]),
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
        linkFetch: DEFAULT_LINK_FETCH,
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

describe("the linked text budget in the provider", () => {
  it("cuts the crossing link and logs the one past the budget", async () => {
    const pages: Record<string, string> = {
      "https://a.example/": "a".repeat(20),
      "https://b.example/": "b".repeat(20),
    };
    const servePage: typeof fetchText = async (url) => ({
      text: pages[url] ?? "",
    });
    vi.mocked(fetchText)
      .mockImplementationOnce(servePage)
      .mockImplementationOnce(servePage);
    const logs: string[] = [];
    const provider = createUrlContextProvider({
      linkFetch: { ...DEFAULT_LINK_FETCH, maxTotalChars: 15 },
    });

    const outcome = await provider.fetch(
      makeQuery("see https://a.example/ and https://b.example/"),
      stubDeps(logs),
    );

    expect(outcome).toEqual({
      ok: true,
      value: [
        {
          providerId: ContextProviderTypes.URL,
          source: "https://a.example/",
          text: "a".repeat(15),
        },
      ],
    });
    expect(logs).toContain(
      "linked context: https://b.example/ past the linked text budget, skipping",
    );
  });
});

describe("the linkFetch policy", () => {
  const body =
    "see https://docs.example/a and https://other.example/b and https://docs.example.evil/c";

  async function fetchUnderPolicy(linkFetch: LinkFetchPolicy) {
    const asked: string[] = [];
    const logs: string[] = [];
    const provider = createUrlContextProvider({
      linkFetch,
      resolveAddresses: stubResolver([LOOPBACK_RECORD], asked),
    });
    const outcome = await provider.fetch(makeQuery(body), stubDeps(logs));
    return { outcome, asked, logs };
  }

  it("fetches nothing when the policy is off", async () => {
    const { outcome, asked, logs } = await fetchUnderPolicy({
      ...DEFAULT_LINK_FETCH,
      mode: LinkFetchModes.OFF,
      hosts: [],
    });

    expect(outcome).toEqual({ ok: true, value: [] });
    expect(asked).toEqual([]);
    expect(logs).toEqual(["linked context: link fetch is off, skipping 3"]);
  });

  it("asks only for the hosts on the allowlist", async () => {
    const { asked, logs } = await fetchUnderPolicy({
      ...DEFAULT_LINK_FETCH,
      mode: LinkFetchModes.ALLOWLIST,
      hosts: ["docs.example"],
    });

    expect(asked).toEqual(["docs.example"]);
    expect(
      logs.filter((line) => line.includes("not on the link fetch allowlist")),
    ).toHaveLength(2);
  });

  it("matches an allowlisted host in any case", async () => {
    const asked: string[] = [];
    const provider = createUrlContextProvider({
      linkFetch: {
        ...DEFAULT_LINK_FETCH,
        mode: LinkFetchModes.ALLOWLIST,
        hosts: ["docs.example"],
      },
      resolveAddresses: stubResolver([LOOPBACK_RECORD], asked),
    });

    await provider.fetch(makeQuery("see https://DOCS.Example/a"), stubDeps());

    expect(asked).toEqual(["docs.example"]);
  });

  it("still refuses a blocked address on an allowlisted host", async () => {
    const { outcome, logs } = await fetchUnderPolicy({
      ...DEFAULT_LINK_FETCH,
      mode: LinkFetchModes.ALLOWLIST,
      hosts: ["docs.example"],
    });

    expect(outcome).toEqual({ ok: true, value: [] });
    expect(logs.some((line) => line.includes("private address"))).toBe(true);
  });

  it("asks for every public link when the policy is public", async () => {
    const { asked } = await fetchUnderPolicy(DEFAULT_LINK_FETCH);

    expect(asked).toEqual([
      "docs.example",
      "other.example",
      "docs.example.evil",
    ]);
  });
});

describe("the linkFetch policy at each caller", () => {
  it("is required, never defaulted to public", () => {
    expectTypeOf(createBuiltInContextProviders).parameters.toEqualTypeOf<
      [LinkFetchPolicy]
    >();
    expectTypeOf<
      UrlContextProviderOptions["linkFetch"]
    >().toEqualTypeOf<LinkFetchPolicy>();
  });
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
    { address: "2002:7f00:1::1", family: 6 },
    { address: "2001:0:4136:e378::1", family: 6 },
    { address: "3fff::1", family: 6 },
    { address: "2001:db8::1", family: 6 },
    { address: "5f00::1", family: 6 },
    { address: "100::1", family: 6 },
    { address: "ff02::1", family: 6 },
    { address: "::ffff:0:7f00:1", family: 6 },
    { address: "224.0.0.1", family: 4 },
    { address: "192.88.99.1", family: 4 },
    { address: "192.0.2.1", family: 4 },
    { address: "198.51.100.1", family: 4 },
    { address: "203.0.113.1", family: 4 },
  ])("refuses a name resolving to $address", async (record) => {
    const lookup = createValidatingLookup(stubResolver([record]));
    const outcome = await attemptConnection(lookup, true);
    expect(outcome).toEqual({ errorCode: "ESSRFBLOCKED" });
  });

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

const STREAM_GAP_MS = 30;

interface StubResponse {
  readonly headers: Record<string, string>;
  readonly body: Buffer | string;
}

async function listenWithResponse(response: StubResponse) {
  const server = createServer((_, reply) => {
    reply.writeHead(200, response.headers);
    reply.end(response.body);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { server, port };
}

// The test's own listener sits on loopback, past the guard on purpose.
function stubLoopbackLookup(
  _hostname: Parameters<LookupFunction>[0],
  options: Parameters<LookupFunction>[1],
  callback: Parameters<LookupFunction>[2],
): void {
  if (options.all === true) {
    callback(null, [LOOPBACK_RECORD]);
    return;
  }
  callback(null, LOOPBACK_RECORD.address, LOOPBACK_RECORD.family);
}

async function fetchStubbedResponse(response: StubResponse) {
  const { server, port } = await listenWithResponse(response);
  try {
    return await fetchText(
      `http://docs.example:${port}/page`,
      new AbortController().signal,
      stubLoopbackLookup,
    );
  } finally {
    server.close();
  }
}

describe("fetchText, the body reader", () => {
  it.each([
    "text/html; charset=utf-8",
    "text/plain",
    "application/json",
    "application/xml",
    "application/problem+json",
    "application/atom+xml",
    "TEXT/MARKDOWN",
  ])("reads a %s body", async (contentType) => {
    const outcome = await fetchStubbedResponse({
      headers: { "content-type": contentType },
      body: "readable",
    });
    expect(outcome).toEqual({ text: "readable" });
  });

  it.each([
    "application/octet-stream",
    "image/png",
    "application/pdf",
    "application/zip",
  ])("skips a %s body", async (contentType) => {
    const outcome = await fetchStubbedResponse({
      headers: { "content-type": contentType },
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    expect(outcome).toEqual({ error: "non-text content type" });
  });

  it("skips a body with no content type", async () => {
    const outcome = await fetchStubbedResponse({
      headers: {},
      body: "untyped",
    });
    expect(outcome).toEqual({ error: "non-text content type" });
  });

  it("keeps the first snippet-cap chars of a body that streams past it", async () => {
    const piece = "a".repeat(MAX_SNIPPET_CHARS / 2 + 1);
    const server = createServer((_, reply) => {
      reply.writeHead(200, { "content-type": "text/plain" });
      reply.write(piece);
      setTimeout(() => reply.write(piece), STREAM_GAP_MS);
      setTimeout(() => reply.end(piece), STREAM_GAP_MS * 2);
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;

    try {
      const outcome = await fetchText(
        `http://docs.example:${port}/page`,
        new AbortController().signal,
        stubLoopbackLookup,
      );
      expect(outcome).toEqual({ text: "a".repeat(MAX_SNIPPET_CHARS) });
    } finally {
      server.close();
    }
  });

  it("closes the connection of an answer it will not read", async () => {
    const SOCKET_WAIT_MS = 1000;
    const socketClosed = Promise.withResolvers<"closed">();
    const server = createServer((request, reply) => {
      reply.writeHead(404, { "content-type": "text/plain" });
      const drip = setInterval(() => reply.write("x"), STREAM_GAP_MS);
      request.socket.on("close", () => {
        clearInterval(drip);
        socketClosed.resolve("closed");
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as AddressInfo;

    try {
      const outcome = await fetchText(
        `http://docs.example:${port}/missing`,
        new AbortController().signal,
        stubLoopbackLookup,
      );
      const stillOpen = new Promise<"open">((resolve) => {
        setTimeout(resolve, SOCKET_WAIT_MS, "open");
      });

      expect(outcome).toEqual({ error: "HTTP 404" });
      await expect(
        Promise.race([socketClosed.promise, stillOpen]),
      ).resolves.toBe("closed");
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("never splits a surrogate pair at the snippet cap", async () => {
    const lead = "a".repeat(MAX_SNIPPET_CHARS - 1);
    const outcome = await fetchStubbedResponse({
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: `${lead}\u{1F600}${"b".repeat(MAX_SNIPPET_CHARS)}`,
    });

    expect(outcome).toEqual({ text: lead });
  });

  it("skips a gzip body even under a text content type", async () => {
    const outcome = await fetchStubbedResponse({
      headers: { "content-type": "text/html", "content-encoding": "gzip" },
      body: gzipSync("compressed"),
    });
    expect(outcome).toEqual({ error: "encoded body" });
  });
});

describe("fetchText on an HTML page", () => {
  const HTML = { "content-type": "text/html; charset=utf-8" };

  it("drops what a reader never sees before it cuts at the snippet cap", async () => {
    const state = "x".repeat(MAX_SNIPPET_CHARS);
    const page = [
      "<!doctype html><html>",
      `<head><title>T</title><script>var s="${state}";</script></head>`,
      "<body><style>.a{color:red}</style><p>Shown</p>",
      '<script type="application/json">{"k":"v"}</script>',
      "<noscript>turn it on</noscript><template><b>slot</b></template>",
      "<p>More</p></body></html>",
    ].join("");

    const outcome = await fetchStubbedResponse({ headers: HTML, body: page });

    expect(outcome).toEqual({
      text: "<!doctype html><html> <body> <p>Shown</p>   <p>More</p></body></html>",
    });
  });

  it.each([
    ["upper case", "<SCRIPT>a()</SCRIPT>"],
    ["attributes", '<script src="/a.js" defer></script>'],
    ["a spaced closing tag", "<style>.a{}</style >"],
    ["an XHTML content type", "<script>a()</script>"],
  ])("drops an element written with %s", async (label, element) => {
    const xhtml = { "content-type": "application/xhtml+xml" };
    const headers = label === "an XHTML content type" ? xhtml : HTML;

    const outcome = await fetchStubbedResponse({
      headers,
      body: `<p>a</p>${element}<p>b</p>`,
    });

    expect(outcome).toEqual({ text: "<p>a</p> <p>b</p>" });
  });

  it("drops the rest of the page after an element that never closes", async () => {
    const outcome = await fetchStubbedResponse({
      headers: HTML,
      body: "<p>Shown</p><script>never closed <p>hidden</p>",
    });

    expect(outcome).toEqual({ text: "<p>Shown</p> " });
  });

  it("ends a head with no closing tag where the body starts", async () => {
    const outcome = await fetchStubbedResponse({
      headers: HTML,
      body: "<html><head><title>T</title><script>a()</script><body><p>Shown</p>",
    });

    expect(outcome).toEqual({ text: "<html> <body><p>Shown</p>" });
  });

  it("drops only the tag of a head that neither closes nor meets a body", async () => {
    const outcome = await fetchStubbedResponse({
      headers: HTML,
      body: "<head><title>T</title><p>Shown</p>",
    });

    expect(outcome).toEqual({ text: " <title>T</title><p>Shown</p>" });
  });

  it("drops a comment whole, so a tag named inside it opens nothing", async () => {
    const outcome = await fetchStubbedResponse({
      headers: HTML,
      body: "<p>a</p><!-- <script> --><p>b</p>",
    });

    expect(outcome).toEqual({ text: "<p>a</p> <p>b</p>" });
  });

  it("keeps an element whose name only starts like a dropped one", async () => {
    const page = "<header>Top</header><p>Shown</p>";

    const outcome = await fetchStubbedResponse({ headers: HTML, body: page });

    expect(outcome).toEqual({ text: page });
  });

  it("leaves a body that is not HTML as it is", async () => {
    const body = "<script>kept()</script>";

    const outcome = await fetchStubbedResponse({
      headers: { "content-type": "text/plain" },
      body,
    });

    expect(outcome).toEqual({ text: body });
  });

  it("stops reading a page at the page cap", async () => {
    const outcome = await fetchStubbedResponse({
      headers: HTML,
      body: `<script>${"s".repeat(MAX_PAGE_CHARS)}</script><p>past the cap</p>`,
    });

    expect(outcome).toEqual({ text: " " });
  });
});

describe("removeUnshownElements cost", () => {
  it.each([
    ["heads that never close", (chars: number) => "<head>".repeat(chars / 6)],
    ["head tags that never end", (chars: number) => "<head ".repeat(chars / 6)],
    [
      "heads that each meet a body",
      (chars: number) => "<head><body>".repeat(chars / 12),
    ],
    [
      "scripts that open inside comments",
      (chars: number) => "<!--<script>-->".repeat(chars / 15),
    ],
  ])("strips a page of %s in linear time", (_label, makePage) => {
    const ratio = measureGrowthRatio((scale) => {
      const page = makePage(MAX_PAGE_CHARS * scale);
      return () => removeUnshownElements(page);
    });

    expect(ratio).toBeLessThan(LINEAR_GROWTH_CEILING);
  });
});

interface LookupAnswer {
  readonly hostname: string;
  readonly errorCode?: string;
  readonly addresses: LookupAddress[];
}

function askResolver(
  resolve: AddressResolver,
  hostname: string,
): Promise<LookupAnswer> {
  return new Promise((settle) => {
    resolve(hostname, (error, addresses) => {
      const answer: Mutable<LookupAnswer> = { hostname, addresses };
      if (error) {
        answer.errorCode = error.code ?? "";
      }
      settle(answer);
    });
  });
}

function stubSilentResolver(asked: string[] = []): AddressResolver {
  return (hostname) => {
    asked.push(hostname);
  };
}

describe("boundAddressResolver, the lookup bounds", () => {
  const LOOKUP_DEADLINE_MS = 50;

  it("times out a resolver that never answers", async () => {
    const bounded = boundAddressResolver(stubSilentResolver(), {
      timeoutMs: LOOKUP_DEADLINE_MS,
      maxConcurrent: 2,
    });

    const answer = await askResolver(bounded, "silent.example");

    expect(answer).toEqual({
      hostname: "silent.example",
      addresses: [],
      errorCode: "ELOOKUPTIMEOUT",
    });
  });

  it("answers a parallel lookup while a silent one holds a slot", async () => {
    const silent = stubSilentResolver();
    const answering = stubResolver([PUBLIC_RECORD]);
    const bounded = boundAddressResolver(
      (hostname, callback) => {
        const resolve = hostname === "silent.example" ? silent : answering;
        resolve(hostname, callback);
      },
      { timeoutMs: 1_000, maxConcurrent: 2 },
    );

    void askResolver(bounded, "silent.example");
    const answer = await askResolver(bounded, "docs.example");

    expect(answer).toEqual({
      hostname: "docs.example",
      addresses: [PUBLIC_RECORD],
    });
  });

  it("holds lookups past the cap until a slot frees", async () => {
    vi.useFakeTimers();
    try {
      const asked: string[] = [];
      const silent = stubSilentResolver(asked);
      const bounded = boundAddressResolver(
        (hostname, callback) => {
          if (hostname !== "a.example") {
            silent(hostname, callback);
            return;
          }
          asked.push(hostname);
          setTimeout(() => callback(null, [PUBLIC_RECORD]), 10);
        },
        { timeoutMs: LOOKUP_DEADLINE_MS, maxConcurrent: 2 },
      );

      const answers = Promise.all(
        ["a.example", "b.example", "c.example"].map((hostname) =>
          askResolver(bounded, hostname),
        ),
      );
      const askedBeforeAnswer = [...asked];
      await vi.advanceTimersByTimeAsync(LOOKUP_DEADLINE_MS);
      const settled = await answers;

      expect(askedBeforeAnswer).toEqual(["a.example", "b.example"]);
      expect(asked).toEqual(["a.example", "b.example", "c.example"]);
      expect(settled.map((answer) => answer.errorCode)).toEqual([
        undefined,
        "ELOOKUPTIMEOUT",
        "ELOOKUPTIMEOUT",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never sends a lookup whose deadline passed in the queue", async () => {
    vi.useFakeTimers();
    try {
      const asked: string[] = [];
      const bounded = boundAddressResolver(stubSilentResolver(asked), {
        timeoutMs: LOOKUP_DEADLINE_MS,
        maxConcurrent: 1,
      });

      const answers = Promise.all(
        ["a.example", "b.example", "c.example"].map((hostname) =>
          askResolver(bounded, hostname),
        ),
      );
      await vi.advanceTimersByTimeAsync(LOOKUP_DEADLINE_MS);
      const settled = await answers;

      expect(asked).toEqual(["a.example"]);
      expect(settled.map((answer) => answer.errorCode)).toEqual([
        "ELOOKUPTIMEOUT",
        "ELOOKUPTIMEOUT",
        "ELOOKUPTIMEOUT",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores an answer that arrives after the deadline", async () => {
    const bounded = boundAddressResolver(
      (_, callback) => {
        setTimeout(() => callback(null, [LOOPBACK_RECORD]), 80);
      },
      { timeoutMs: LOOKUP_DEADLINE_MS, maxConcurrent: 1 },
    );
    const calls: LookupAnswer[] = [];

    await new Promise<void>((done) => {
      bounded("late.example", (error, addresses) => {
        calls.push({
          hostname: "late.example",
          addresses,
          errorCode: error?.code ?? "",
        });
      });
      setTimeout(done, 120);
    });

    expect(calls).toEqual([
      { hostname: "late.example", addresses: [], errorCode: "ELOOKUPTIMEOUT" },
    ]);
  });
});

type RecordsCallback = Parameters<DnsRecordResolver["resolve4"]>[1];

interface FamilyReply {
  readonly errorCode?: string;
  readonly records?: string[];
}

interface StubDnsResolver extends DnsRecordResolver {
  readonly cancelled: () => number;
}

function makeDnsError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

// A missing reply stays silent until cancel, which fails it as c-ares does.
function stubDnsResolver(replies: {
  readonly ipv4?: FamilyReply;
  readonly ipv6?: FamilyReply;
}): StubDnsResolver {
  const pending: RecordsCallback[] = [];
  let cancelCount = 0;

  function reply(answer: FamilyReply | undefined, callback: RecordsCallback) {
    if (answer === undefined) {
      pending.push(callback);
      return;
    }
    queueMicrotask(() => {
      if (answer.errorCode !== undefined) {
        callback(makeDnsError(answer.errorCode), []);
        return;
      }
      callback(null, answer.records ?? []);
    });
  }

  return {
    resolve4: (_, callback) => reply(replies.ipv4, callback),
    resolve6: (_, callback) => reply(replies.ipv6, callback),
    cancel: () => {
      cancelCount += 1;
      for (const callback of pending.splice(0)) {
        callback(makeDnsError("ECANCELLED"), []);
      }
    },
    cancelled: () => cancelCount,
  };
}

function askDns(resolver: DnsRecordResolver): Promise<LookupAnswer> {
  return askResolver(
    (hostname, callback) => queryAllAddresses(resolver, hostname, callback),
    "docs.example",
  );
}

describe("queryAllAddresses, the c-ares lookup", () => {
  it("answers with one family when the other errors", async () => {
    const resolver = stubDnsResolver({
      ipv4: { records: [PUBLIC_RECORD.address] },
      ipv6: { errorCode: "ENODATA" },
    });

    const answer = await askDns(resolver);

    expect(answer).toEqual({
      hostname: "docs.example",
      addresses: [PUBLIC_RECORD],
    });
  });

  it("fails when both families error", async () => {
    const resolver = stubDnsResolver({
      ipv4: { errorCode: "ENOTFOUND" },
      ipv6: { errorCode: "ENODATA" },
    });

    const answer = await askDns(resolver);

    expect(answer).toEqual({
      hostname: "docs.example",
      addresses: [],
      errorCode: "ENOTFOUND",
    });
    expect(resolver.cancelled()).toBe(0);
  });

  it("cancels both silent queries inside the lookup deadline", async () => {
    vi.useFakeTimers();
    try {
      const resolver = stubDnsResolver({});
      const cancelAt = LINK_LOOKUP_BOUNDS.timeoutMs - DNS_CANCEL_MARGIN_MS;

      const answer = askDns(resolver);
      await vi.advanceTimersByTimeAsync(cancelAt - 1);
      const cancelledBeforeDeadline = resolver.cancelled();
      await vi.advanceTimersByTimeAsync(1);

      expect(cancelledBeforeDeadline).toBe(0);
      expect(resolver.cancelled()).toBe(1);
      expect(await answer).toEqual({
        hostname: "docs.example",
        addresses: [],
        errorCode: "ECANCELLED",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("queryAllAddresses under the lookup bounds", () => {
  /** Holds the only slot this long before the lookup under test starts. */
  const SLOT_HELD_MS = 1_000;

  function stubAnswerWithoutAaaa(): StubDnsResolver {
    return stubDnsResolver({ ipv4: { records: [PUBLIC_RECORD.address] } });
  }

  it("keeps the A answer when the AAAA query stays silent", async () => {
    vi.useFakeTimers();
    try {
      const bounded = boundAddressResolver(
        (hostname, callback) =>
          queryAllAddresses(stubAnswerWithoutAaaa(), hostname, callback),
        LINK_LOOKUP_BOUNDS,
      );

      const answer = askResolver(bounded, "docs.example");
      await vi.advanceTimersByTimeAsync(LINK_LOOKUP_BOUNDS.timeoutMs);

      expect(await answer).toEqual({
        hostname: "docs.example",
        addresses: [PUBLIC_RECORD],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the A answer of a lookup that waited for a slot", async () => {
    vi.useFakeTimers();
    try {
      const bounded = boundAddressResolver(
        (hostname, callback) => {
          if (hostname === "slow.example") {
            setTimeout(
              () => callback(makeDnsError("ENOTFOUND"), []),
              SLOT_HELD_MS,
            );
            return;
          }
          queryAllAddresses(stubAnswerWithoutAaaa(), hostname, callback);
        },
        { ...LINK_LOOKUP_BOUNDS, maxConcurrent: 1 },
      );

      void askResolver(bounded, "slow.example");
      const answer = askResolver(bounded, "docs.example");
      await vi.advanceTimersByTimeAsync(LINK_LOOKUP_BOUNDS.timeoutMs);

      expect(await answer).toEqual({
        hostname: "docs.example",
        addresses: [PUBLIC_RECORD],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("fitLinkedTextBudget", () => {
  function makeSnippet(source: string, length: number): ProviderSnippet {
    return {
      providerId: ContextProviderTypes.URL,
      source,
      text: "x".repeat(length),
    };
  }
  const snippets = [
    makeSnippet("https://a.example/", 20_000),
    makeSnippet("https://b.example/", 20_000),
    makeSnippet("https://c.example/", 20_000),
  ];

  it("cuts the link that crosses the budget and skips the rest", () => {
    const fitted = fitLinkedTextBudget(snippets, 30_000);

    expect(fitted.kept.map((snippet) => snippet.text.length)).toEqual([
      20_000, 10_000,
    ]);
    expect(fitted.skipped).toEqual(["https://c.example/"]);
  });

  it("never splits a surrogate pair at the budget", () => {
    const straddling: ProviderSnippet = {
      providerId: ContextProviderTypes.URL,
      source: "https://d.example/",
      text: `${"x".repeat(9)}\u{1F600}tail`,
    };

    const fitted = fitLinkedTextBudget([straddling], 10);

    expect(fitted.kept.map((snippet) => snippet.text)).toEqual(["x".repeat(9)]);
  });

  it("keeps every link whole under a larger budget", () => {
    const fitted = fitLinkedTextBudget(snippets, 100_000);

    expect(fitted.kept).toEqual(snippets);
    expect(fitted.skipped).toEqual([]);
  });
});
