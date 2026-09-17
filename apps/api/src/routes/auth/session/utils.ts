// TRUST SHAPE: a session cookie carries a high-entropy RANDOM token; the DB
// stores only its SHA-256 (globally unique). Session resolution PRECEDES
// tenant scoping, so it is what tells us the installation. No token, code or
// secret is ever logged or placed in a response beyond the opaque cookie.
import { createHash } from "node:crypto";

/**
 * SHA-256 hex of a cookie token, the globally-unique DB key for a session.
 * Exported so the authz middleware hashes the incoming cookie identically.
 */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
