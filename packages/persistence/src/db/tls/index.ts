// TLS allowlist: a non-loopback DSN boots only on `sslmode=verify-full` or
// `sslmode=disable`, and `uselibpqcompat=true` only beside verify-full. Every
// other mode skips certificate verification under libpq semantics (opt-in
// today, pg v9's default). Loopback and unix-socket hosts are exempt. This
// package's `pg-connection-string` must resolve to the version pg bundles, so
// the DSN is classified exactly as the driver parses it.
import { parse } from "pg-connection-string";
import type { Result } from "types/utils";
import { AllowedSslModes, type AllowedSslMode } from "./types";

const LIBPQ_COMPAT_ENABLED = "true";

/** Hosts whose traffic never leaves the machine: exact `localhost`, the
 * 127.0.0.0/8 block (plus its IPv6-mapped form), IPv6 `::1`, or a unix-socket
 * path. An empty host is NOT loopback: pg then dials `PGHOST` over TCP. */
function isLoopbackHost(host: string | null | undefined): boolean {
  if (host === null || host === undefined || host.length === 0) {
    return false;
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
  "DATABASE_URL: a non-loopback host needs sslmode=verify-full (add " +
  "sslrootcert=/path/to/ca.pem for a private CA) or sslmode=disable (private " +
  "networks only). require, prefer, verify-ca, no-verify and uselibpqcompat " +
  "are refused because they can skip certificate verification";

function isAllowedSslMode(sslmode: unknown): sslmode is AllowedSslMode {
  return Object.values(AllowedSslModes).some((mode) => mode === sslmode);
}

/**
 * Enforce the TLS allowlist on an already-scheme-validated DSN.
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
  // `sslmode` and `uselibpqcompat` ride the parse result's passthrough index
  // signature, last occurrence winning as the driver reads them. A missing or
  // empty `sslmode` is not on the allowlist, so it refuses like any other.
  const sslmode = parsed["sslmode"];
  if (!isAllowedSslMode(sslmode)) {
    return { ok: false, error: REFUSAL };
  }

  const libpqCompatWithoutVerifyFull =
    parsed["uselibpqcompat"] === LIBPQ_COMPAT_ENABLED &&
    sslmode !== AllowedSslModes.VERIFY_FULL;
  if (libpqCompatWithoutVerifyFull) {
    return { ok: false, error: REFUSAL };
  }
  return { ok: true, value: undefined };
}
