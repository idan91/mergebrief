// GitHub OAuth token encryption for `auth_session.gh_token_ciphertext`.
// AES-256-GCM (authenticated encryption) behind a key-provider interface.
//
// ENCRYPTION MODEL: DIRECT encryption with a provider-resolved key — NOT a
// per-row envelope DEK. Reviewer tokens are short-lived and deleted on
// expiry/logout, so rotation rides on natural token churn.
//
// KEY ROTATION WITHOUT A MIGRATION: every row stores the `key_ref` that sealed
// it and passes it back into `decryptToken`, so publishing a new key is a
// config change only — old rows keep decrypting under their own `key_ref`.
//
// KEY PROVIDER SEAM: `resolveKey(keyRef)` is the swap point; it returns a
// `MaybePromise` so an async (KMS) provider drops in without call-site change.
//
// SECURITY: every expected failure is a `Result`, never a throw, and NO error
// message ever contains plaintext or key material.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { MaybePromise, Result, ValueOf } from "../types";

// ---------------------------------------------------------------------------
// Constants — AES-256-GCM parameters. All lengths are in bytes.
// ---------------------------------------------------------------------------

const ALGORITHM = "aes-256-gcm";
/** AES-256 key size. Enforced on the resolved key. */
const KEY_BYTES = 32;
/** GCM standard nonce size — 96-bit IV, one random IV per encryption. */
const IV_BYTES = 12;
/** GCM authentication tag size. */
const TAG_BYTES = 16;
/** The only format version this module emits. */
const VERSION = "v1";
/** Field delimiter. Safe: base64 never contains ".". */
const SEPARATOR = ".";

// ---------------------------------------------------------------------------
// Key provider interface + its env implementation.
// ---------------------------------------------------------------------------

/** Why a key could not be resolved. No value/material is ever surfaced. */
export const KeyErrorCode = {
  /** The named env var is absent or empty. */
  MISSING: "missing",
  /** The env var value is not valid (canonical) base64. */
  MALFORMED: "malformed",
  /** The decoded key is not exactly 32 bytes (AES-256). */
  WRONG_LENGTH: "wrong-length",
} as const;
export type KeyErrorCode = ValueOf<typeof KeyErrorCode>;

export interface KeyError {
  readonly code: KeyErrorCode;
  /** Safe to log: names the `keyRef`, never the key value. */
  readonly message: string;
}

/**
 * The key-resolution interface. `resolveKey` maps a `keyRef` to raw 32 key
 * bytes, or a `KeyError`. Returns a `MaybePromise` so a future async provider
 * (KMS) is a drop-in with no call-site change.
 */
export interface KeyProvider {
  resolveKey(keyRef: string): MaybePromise<Result<Buffer, KeyError>>;
}

/** Environment source — injectable so tests need not mutate `process.env`. */
type EnvSource = Record<string, string | undefined>;

/**
 * Env key provider: `keyRef` is an env var name (e.g. `"SESSION_KEY_V1"`) whose
 * value is base64-encoded 32 bytes. Missing / non-base64 / wrong-length all
 * yield a `KeyError` (never a throw).
 */
export function envKeyProvider(env: EnvSource = process.env): KeyProvider {
  return {
    resolveKey(keyRef: string): Result<Buffer, KeyError> {
      const raw = env[keyRef];
      if (raw === undefined || raw.length === 0) {
        return {
          ok: false,
          error: {
            code: KeyErrorCode.MISSING,
            message: `key env var "${keyRef}" is not set`,
          },
        };
      }
      const decoded = decodeBase64Strict(raw);
      if (decoded === undefined) {
        return {
          ok: false,
          error: {
            code: KeyErrorCode.MALFORMED,
            message: `key env var "${keyRef}" is not valid base64`,
          },
        };
      }
      if (decoded.length !== KEY_BYTES) {
        return {
          ok: false,
          error: {
            code: KeyErrorCode.WRONG_LENGTH,
            message: `key env var "${keyRef}" must decode to ${KEY_BYTES} bytes, got ${decoded.length}`,
          },
        };
      }
      return { ok: true, value: decoded };
    },
  };
}

// ---------------------------------------------------------------------------
// Crypto errors — expected failures. Messages never carry plaintext/key bytes.
// ---------------------------------------------------------------------------

export const CryptoErrorCode = {
  /** The key provider could not resolve `keyRef` (see `cause`). */
  KEY_UNAVAILABLE: "key-unavailable",
  /** The ciphertext string is structurally invalid (segments/base64/lengths). */
  MALFORMED_CIPHERTEXT: "malformed-ciphertext",
  /** The version prefix is not one this module understands. */
  UNKNOWN_VERSION: "unknown-version",
  /** GCM tag verification failed — tampering or wrong key. No plaintext. */
  AUTHENTICATION_FAILED: "authentication-failed",
} as const;
export type CryptoErrorCode = ValueOf<typeof CryptoErrorCode>;

export interface CryptoError {
  readonly code: CryptoErrorCode;
  /** Opaque, safe-to-log. Never contains plaintext or key material. */
  readonly message: string;
  /** Present only for `keyUnavailable`: the underlying key-resolution error. */
  readonly cause?: KeyError;
}

function cryptoFail(
  code: CryptoErrorCode,
  message: string,
  cause?: KeyError,
): Result<never, CryptoError> {
  return {
    ok: false,
    error: cause === undefined ? { code, message } : { code, message, cause },
  };
}

// ---------------------------------------------------------------------------
// Encrypt / decrypt.
//
// Ciphertext format (compact, single string, self-describing):
//   v1.<iv_b64>.<ct_b64>.<tag_b64>
// where iv = 12 random bytes, ct = AES-256-GCM ciphertext, tag = 16-byte GCM
// auth tag. The version prefix lets a future scheme (v2) coexist; an unknown
// prefix is a clean `unknownVersion` error, not a misparse.
// ---------------------------------------------------------------------------

/**
 * Encrypt `plaintext` (the GitHub OAuth token) under the key named by `keyRef`.
 * A fresh random 12-byte IV per call means two encryptions of the same
 * plaintext produce different ciphertexts. Returns the compact `v1.…` string.
 */
export async function encryptToken(
  provider: KeyProvider,
  keyRef: string,
  plaintext: string,
): Promise<Result<string, CryptoError>> {
  const resolved = await provider.resolveKey(keyRef);
  if (!resolved.ok) {
    return cryptoFail(
      CryptoErrorCode.KEY_UNAVAILABLE,
      `could not resolve key "${keyRef}"`,
      resolved.error,
    );
  }
  const key = resolved.value;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const encoded = [
    VERSION,
    iv.toString("base64"),
    ciphertext.toString("base64"),
    tag.toString("base64"),
  ].join(SEPARATOR);
  return { ok: true, value: encoded };
}

/**
 * Decrypt a `v1.…` string produced by `encryptToken`, using the key named by
 * `keyRef` (the value stored on the `auth_session` row). Auth-tag failure
 * (tampering / wrong key), malformed input, and an unknown version all return
 * a `Result` error whose message carries NO plaintext or key material.
 */
export async function decryptToken(
  provider: KeyProvider,
  keyRef: string,
  ciphertext: string,
): Promise<Result<string, CryptoError>> {
  const segments = ciphertext.split(SEPARATOR);
  if (segments.length !== 4) {
    return cryptoFail(
      CryptoErrorCode.MALFORMED_CIPHERTEXT,
      "ciphertext has an unexpected structure",
    );
  }
  const [version, ivPart, ctPart, tagPart] = segments;
  if (version !== VERSION) {
    return cryptoFail(
      CryptoErrorCode.UNKNOWN_VERSION,
      "ciphertext version is not supported",
    );
  }

  const iv = decodeBase64Strict(ivPart ?? "");
  const ct = decodeBase64Strict(ctPart ?? "");
  const tag = decodeBase64Strict(tagPart ?? "");
  if (
    iv === undefined ||
    ct === undefined ||
    tag === undefined ||
    iv.length !== IV_BYTES ||
    tag.length !== TAG_BYTES ||
    ct.length === 0
  ) {
    return cryptoFail(
      CryptoErrorCode.MALFORMED_CIPHERTEXT,
      "ciphertext segments are invalid",
    );
  }

  const resolved = await provider.resolveKey(keyRef);
  if (!resolved.ok) {
    return cryptoFail(
      CryptoErrorCode.KEY_UNAVAILABLE,
      `could not resolve key "${keyRef}"`,
      resolved.error,
    );
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, resolved.value, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
    return { ok: true, value: plaintext.toString("utf8") };
  } catch {
    // `final()` throws on tag mismatch (tampered ciphertext/tag, or wrong key).
    // Swallow the underlying error — it carries nothing useful and we must not
    // leak key/plaintext state — and return a uniform authentication failure.
    return cryptoFail(
      CryptoErrorCode.AUTHENTICATION_FAILED,
      "ciphertext authentication failed",
    );
  }
}

// ---------------------------------------------------------------------------
// Base64 — strict, canonical decode. `Buffer.from(s, "base64")` silently drops
// invalid characters, so we validate the shape and round-trip to reject
// non-canonical input (the malformed-input guard depends on this).
// ---------------------------------------------------------------------------

const BASE64_SHAPE = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeBase64Strict(value: string): Buffer | undefined {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !BASE64_SHAPE.test(value)
  ) {
    return undefined;
  }
  const decoded = Buffer.from(value, "base64");
  // Reject non-canonical encodings (e.g. missing/extra padding, alias forms):
  // a canonical value re-encodes to itself.
  if (decoded.toString("base64") !== value) {
    return undefined;
  }
  return decoded;
}
