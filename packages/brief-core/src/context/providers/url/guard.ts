import { Resolver, type LookupAddress } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import {
  DEFAULT_PORT_BY_PROTOCOL,
  DNS_CANCEL_MARGIN_MS,
  DNS_FAMILY_GRACE_MS,
  DNS_QUERY_TIMEOUT_MS,
  DNS_QUERY_TRIES,
  LINK_LOOKUP_BOUNDS,
  LINK_PORTS,
} from "./consts";
import type {
  AddressResolver,
  BlockedSubnet,
  DnsRecordResolver,
  LookupBounds,
} from "./types";

const BLOCKED_IPV4_SUBNETS: readonly BlockedSubnet[] = [
  { prefix: "0.0.0.0", length: 8 }, // "this network"; 0.0.0.0 reaches the local host
  { prefix: "10.0.0.0", length: 8 },
  { prefix: "100.64.0.0", length: 10 }, // carrier-grade NAT
  { prefix: "127.0.0.0", length: 8 },
  { prefix: "168.63.129.16", length: 32 }, // Azure WireServer, the platform's host agent
  { prefix: "169.254.0.0", length: 16 }, // link-local incl. cloud metadata 169.254.169.254
  { prefix: "172.16.0.0", length: 12 },
  { prefix: "192.0.0.0", length: 24 }, // IETF protocol assignments
  { prefix: "192.0.2.0", length: 24 }, // TEST-NET-1
  { prefix: "192.88.99.0", length: 24 }, // 6to4 relay anycast
  { prefix: "192.168.0.0", length: 16 },
  { prefix: "198.18.0.0", length: 15 }, // benchmarking
  { prefix: "198.51.100.0", length: 24 }, // TEST-NET-2
  { prefix: "203.0.113.0", length: 24 }, // TEST-NET-3
  { prefix: "224.0.0.0", length: 4 }, // multicast
  { prefix: "240.0.0.0", length: 4 }, // reserved, incl. broadcast
];

const BLOCKED_IPV6_SUBNETS: readonly BlockedSubnet[] = [
  { prefix: "::", length: 96 }, // unspecified, loopback and IPv4-compatible ::a.b.c.d
  { prefix: "::ffff:0:0:0", length: 96 }, // IPv4-translated, reached behind an SIIT translator
  { prefix: "64:ff9b::", length: 32 }, // NAT64, embeds an IPv4 address
  { prefix: "100::", length: 64 }, // discard-only
  { prefix: "2001::", length: 23 }, // IETF protocol assignments, incl. Teredo 2001::/32
  { prefix: "2001:db8::", length: 32 }, // documentation
  { prefix: "2002::", length: 16 }, // 6to4, embeds an IPv4 address
  { prefix: "3fff::", length: 20 }, // documentation
  { prefix: "5f00::", length: 16 }, // segment routing SIDs
  { prefix: "fc00::", length: 7 }, // unique-local
  { prefix: "fe80::", length: 10 }, // link-local
  { prefix: "fec0::", length: 10 }, // deprecated site-local
  { prefix: "ff00::", length: 8 }, // multicast
];

function buildBlockedAddresses(): BlockList {
  const blocked = new BlockList();
  for (const { prefix, length } of BLOCKED_IPV4_SUBNETS) {
    blocked.addSubnet(prefix, length, "ipv4");
  }
  for (const { prefix, length } of BLOCKED_IPV6_SUBNETS) {
    blocked.addSubnet(prefix, length, "ipv6");
  }
  return blocked;
}

/** An IPv4 rule also matches the IPv4-mapped IPv6 form, in any spelling. */
const BLOCKED_ADDRESSES = buildBlockedAddresses();

function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) {
    return false;
  }
  return BLOCKED_ADDRESSES.check(address, family === 6 ? "ipv6" : "ipv4");
}

function readEffectivePort(url: URL): number | undefined {
  if (url.port !== "") {
    return Number(url.port);
  }
  return DEFAULT_PORT_BY_PROTOCOL[url.protocol];
}

/**
 * Synchronous pre-filter for a candidate link. Rejects non-http(s) schemes,
 * embedded credentials (userinfo; almost never a real public reference, and a
 * credential-leak hazard), a port outside `allowedPorts`, localhost/`.local`,
 * and blocked IP literals. An IP literal never reaches a lookup, so this is
 * its only gate; a name is checked again at connect time against every
 * resolved address, which closes DNS rebinding.
 */
export function isPublicUrl(
  raw: string,
  allowedPorts: ReadonlySet<number> = LINK_PORTS,
): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return false;
  }
  if (url.username !== "" || url.password !== "") {
    return false;
  }
  const port = readEffectivePort(url);
  if (port === undefined || !allowedPorts.has(port)) {
    return false;
  }
  const host = url.hostname.replace(/^\[|\]$/g, ""); // unwrap [::1]
  if (host === "localhost" || host.endsWith(".local")) {
    return false;
  }
  if (isBlockedAddress(host)) {
    return false;
  }
  return true;
}

interface FamilyAnswer {
  readonly error: NodeJS.ErrnoException | null;
  readonly addresses: LookupAddress[];
}

function settleAddresses(
  hostname: string,
  ipv4: FamilyAnswer,
  ipv6: FamilyAnswer,
  callback: Parameters<AddressResolver>[1],
): void {
  const addresses = [...ipv4.addresses, ...ipv6.addresses];
  if (addresses.length > 0) {
    callback(null, addresses);
    return;
  }
  const error = ipv4.error ?? ipv6.error;
  callback(error ?? new Error(`no address for ${hostname}`), []);
}

/**
 * Every A and AAAA record for a name, asked over c-ares with its own timeout
 * and tries: no libuv threadpool slot, so a silent nameserver stalls only its
 * own query. It reads neither `/etc/hosts` nor the search list.
 */
export function resolveAllAddresses(
  hostname: string,
  callback: Parameters<AddressResolver>[1],
): void {
  const resolver = new Resolver({
    timeout: DNS_QUERY_TIMEOUT_MS,
    tries: DNS_QUERY_TRIES,
  });
  queryAllAddresses(resolver, hostname, callback);
}

/**
 * Both families on one resolver, cancelled inside the lookup bound so a
 * family that answered is never lost to the bound's timeout. Once one
 * family answers with addresses the other gets a short grace, so a
 * nameserver that drops AAAA queries fails no link, queued or not.
 */
export function queryAllAddresses(
  resolver: DnsRecordResolver,
  hostname: string,
  callback: Parameters<AddressResolver>[1],
): void {
  const cancel = setTimeout(
    () => resolver.cancel(),
    LINK_LOOKUP_BOUNDS.timeoutMs - DNS_CANCEL_MARGIN_MS,
  );
  cancel.unref();
  let grace: NodeJS.Timeout | undefined;
  const answers: { ipv4?: FamilyAnswer; ipv6?: FamilyAnswer } = {};

  function collect(answer: FamilyAnswer): void {
    const { ipv4, ipv6 } = answers;
    if (ipv4 !== undefined && ipv6 !== undefined) {
      clearTimeout(cancel);
      clearTimeout(grace);
      settleAddresses(hostname, ipv4, ipv6, callback);
      return;
    }
    if (answer.addresses.length > 0) {
      grace = setTimeout(() => resolver.cancel(), DNS_FAMILY_GRACE_MS);
      grace.unref();
    }
  }

  resolver.resolve4(hostname, (error, records) => {
    answers.ipv4 = {
      error,
      addresses: error
        ? []
        : records.map((address) => ({ address, family: 4 })),
    };
    collect(answers.ipv4);
  });
  resolver.resolve6(hostname, (error, records) => {
    answers.ipv6 = {
      error,
      addresses: error
        ? []
        : records.map((address) => ({ address, family: 6 })),
    };
    collect(answers.ipv6);
  });
}

function makeLookupTimeoutError(hostname: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`lookup timed out for ${hostname}`), {
    code: "ELOOKUPTIMEOUT",
  });
}

/**
 * A resolver held to `bounds`: at most `maxConcurrent` lookups in flight,
 * the rest queued in order. Each lookup is answered by `timeoutMs` after it
 * was asked, queued or not, with a timeout error; one whose deadline passes
 * in the queue is never sent. A slot frees on the first of the answer or the
 * deadline; a late answer is dropped.
 */
export function boundAddressResolver(
  resolve: AddressResolver,
  bounds: LookupBounds,
): AddressResolver {
  const queued: (() => void)[] = [];
  let inFlight = 0;

  function startQueued(): void {
    while (inFlight < bounds.maxConcurrent && queued.length > 0) {
      queued.shift()?.();
    }
  }

  return (hostname, callback) => {
    let settled = false;
    let started = false;

    function settle(...answer: Parameters<typeof callback>): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(deadline);
      if (started) {
        inFlight -= 1;
        startQueued();
      }
      callback(...answer);
    }

    function start(): void {
      if (settled) {
        return;
      }
      if (performance.now() >= deadlineAt) {
        settle(makeLookupTimeoutError(hostname), []);
        return;
      }
      started = true;
      inFlight += 1;
      resolve(hostname, settle);
    }

    const deadlineAt = performance.now() + bounds.timeoutMs;
    const deadline = setTimeout(() => {
      settle(makeLookupTimeoutError(hostname), []);
    }, bounds.timeoutMs);
    deadline.unref();

    if (inFlight < bounds.maxConcurrent) {
      start();
      return;
    }
    queued.push(start);
  };
}

function makeBlockedAddressError(address: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`blocked private address ${address}`), {
    code: "ESSRFBLOCKED",
  });
}

/**
 * A `dns.lookup`-shaped function that refuses a name when any of its records
 * is blocked, then answers in the form node asked for: every record under
 * `all` (node 24's family autoselection), else the first. The socket connects
 * only to an address this check saw.
 */
export function createValidatingLookup(
  resolve: AddressResolver,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, (error, addresses) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      const blocked = addresses.find((record) =>
        isBlockedAddress(record.address),
      );
      if (blocked) {
        callback(makeBlockedAddressError(blocked.address), "", 0);
        return;
      }
      const first = addresses[0];
      if (!first) {
        callback(new Error("no address"), "", 0);
        return;
      }
      if (options.all === true) {
        callback(null, addresses);
        return;
      }
      callback(null, first.address, first.family);
    });
  };
}
