// TLS explicit-or-refuse: an external Postgres DSN must carry an explicit
// `sslmode`, so a plaintext or unverified managed-DB connection is never
// silent. Loopback and unix-socket hosts are exempt. The gate only enforces
// that a CHOICE was made; `pg` itself honors the parameters.
// pg 8.x treats `require`/`prefer`/`verify-ca` as verify-full; pg v9 adopts
// libpq semantics where `require` does NOT verify certificates. This
// package's `pg-connection-string` must resolve to the version pg bundles, so
// the DSN is classified exactly as the driver parses it.
import { parse } from "pg-connection-string";
import type { Result } from "types/utils";

/** Hosts whose traffic never leaves the machine: exact `localhost`, the
 * 127.0.0.0/8 block (plus its IPv6-mapped form), IPv6 `::1`, a unix-socket
 * path, or no host at all (pg defaults to the local socket). */
function isLoopbackHost(host: string | null | undefined): boolean {
  if (host === null || host === undefined || host.length === 0) {
    return true;
  }
  if (host.startsWith("/")) {
    return true;
  }
  const bare = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  return (
    bare === "localhost" ||
    bare === "::1" ||
    isLoopbackIpv4(bare) ||
    (bare.startsWith("::ffff:") && isLoopbackIpv4(bare.slice("::ffff:".length)))
  );
}

/** Strict 127.0.0.0/8 literal. Octets are range-checked: `127.0.0.999` is
 * NOT an IP: the driver would hand it to DNS, where a resolver search
 * suffix could take it off-box, so it must not classify as loopback. */
function isLoopbackIpv4(host: string): boolean {
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (match === null) {
    return false;
  }
  return match.slice(1).every((octet) => Number(octet) <= 255);
}

const REFUSAL =
  "DATABASE_URL: non-loopback host with no sslmode — choose one explicitly: " +
  "sslmode=verify-full with sslrootcert=/path/to/ca.pem (verified TLS; the " +
  "recommended posture for managed providers), sslmode=require (TLS without " +
  "a pinned CA — note pg treats it as verify-full today but pg v9 will stop " +
  "verifying), or sslmode=disable (private networks only)";

/**
 * Enforce the explicit-or-refuse rule on an already-scheme-validated DSN.
 * Refusal text is value-free: neither the DSN nor its host is echoed (the
 * URL may carry a password; the message is generic on purpose). A DSN
 * pg-connection-string cannot parse is refused generically too, except a
 * file it failed to READ (`sslrootcert=...`), whose path (an operator
 * pointer, not a credential) is named.
 */
export function checkDsnTls(databaseUrl: string): Result<undefined, string> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(databaseUrl);
  } catch (cause) {
    // pg-connection-string reads `sslrootcert`/`sslcert`/`sslkey` files at
    // parse time; a missing CA bundle surfaces here as an fs error.
    if (
      cause instanceof Error &&
      "code" in cause &&
      typeof cause.code === "string" &&
      "path" in cause &&
      typeof cause.path === "string"
    ) {
      return {
        ok: false,
        error: `DATABASE_URL: cannot read a file the connection string references (${cause.code}: ${cause.path})`,
      };
    }
    return {
      ok: false,
      error:
        "DATABASE_URL: unparseable connection string (value withheld — it may carry credentials)",
    };
  }

  if (isLoopbackHost(parsed.host)) {
    return { ok: true, value: undefined };
  }
  // `sslmode` rides pg-connection-string's passthrough index signature: it
  // is present exactly when the DSN carried the parameter. An EMPTY value
  // (`?sslmode=`, e.g. from unset shell templating) counts as absent: pg's
  // own ssl-enablement check is a truthiness test, so `sslmode=` behaves
  // exactly like no sslmode at all: plaintext.
  const sslmode = parsed["sslmode"];
  if (sslmode === undefined || sslmode === "") {
    return { ok: false, error: REFUSAL };
  }
  return { ok: true, value: undefined };
}
