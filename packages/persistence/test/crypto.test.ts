// Stage 6 token-crypto tests (D11). Cover the security gates: round-trip,
// tamper/wrong-key auth failure (Result, no throw, no key material leaked), key
// env validation, IV randomness, and version rejection. Result narrowing uses
// the repo's `if (!x.ok) throw` pattern so no `expect` is conditional.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CryptoErrorCode,
  KeyErrorCode,
  decryptToken,
  encryptToken,
  envKeyProvider,
  type CryptoError,
  type KeyProvider,
} from "../src/crypto.js";
import type { Result } from "../src/types.js";

const KEY_REF = "SESSION_KEY_V1";
const OTHER_KEY_REF = "SESSION_KEY_V2";
const TOKEN = "gho_16C7e42F292c6912E7710c838347Ae178B4a"; // shape of a GitHub token

/** A base64 32-byte key. */
function freshKeyB64(): string {
  return randomBytes(32).toString("base64");
}

/** Env-backed provider with the given key vars set. */
function providerWith(vars: Record<string, string>): KeyProvider {
  return envKeyProvider(vars);
}

/** Unwrap a successful encrypt or fail the test loudly. */
async function seal(
  provider: KeyProvider,
  keyRef: string,
  plaintext: string,
): Promise<string> {
  const enc = await encryptToken(provider, keyRef, plaintext);
  if (!enc.ok) {
    throw new Error(`setup: encrypt failed (${enc.error.code})`);
  }
  return enc.value;
}

/** The error of a decrypt expected to fail. */
function decryptError(result: Result<string, CryptoError>): CryptoError {
  if (result.ok) {
    throw new Error("expected decrypt to fail");
  }
  return result.error;
}

describe("crypto — key provider (envKeyProvider)", () => {
  it("resolves a valid base64 32-byte key", async () => {
    const result = await providerWith({ [KEY_REF]: freshKeyB64() }).resolveKey(
      KEY_REF,
    );
    if (!result.ok) {
      throw new Error("expected key to resolve");
    }
    expect(result.value.length).toBe(32);
  });

  it("missing env var → missing error, no throw", async () => {
    const result = await providerWith({}).resolveKey(KEY_REF);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected missing");
    expect(result.error.code).toBe(KeyErrorCode.MISSING);
  });

  it("empty env var → missing error", async () => {
    const result = await providerWith({ [KEY_REF]: "" }).resolveKey(KEY_REF);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected missing");
    expect(result.error.code).toBe(KeyErrorCode.MISSING);
  });

  it("non-base64 env var → malformed error", async () => {
    const result = await providerWith({
      [KEY_REF]: "not valid base64 !!!",
    }).resolveKey(KEY_REF);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected malformed");
    expect(result.error.code).toBe(KeyErrorCode.MALFORMED);
  });

  it("short (non-32-byte) key → wrongLength error", async () => {
    const short = randomBytes(16).toString("base64");
    const result = await providerWith({ [KEY_REF]: short }).resolveKey(KEY_REF);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected wrongLength");
    expect(result.error.code).toBe(KeyErrorCode.WRONG_LENGTH);
  });

  it("no error message contains the key value", async () => {
    const short = randomBytes(30).toString("base64");
    const result = await providerWith({ [KEY_REF]: short }).resolveKey(KEY_REF);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected wrongLength");
    expect(result.error.message).not.toContain(short);
  });
});

describe("crypto — encrypt/decrypt round-trip", () => {
  it("decrypts what it encrypted", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const sealed = await seal(provider, KEY_REF, TOKEN);
    expect(sealed.startsWith("v1.")).toBe(true);

    const dec = await decryptToken(provider, KEY_REF, sealed);
    if (!dec.ok) throw new Error("expected decrypt to succeed");
    expect(dec.value).toBe(TOKEN);
  });

  it("round-trips unicode and long tokens", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    for (const plaintext of ["ünïcödé-🔑-token", "x".repeat(4096)]) {
      const sealed = await seal(provider, KEY_REF, plaintext);
      const dec = await decryptToken(provider, KEY_REF, sealed);
      if (!dec.ok) throw new Error("expected decrypt to succeed");
      expect(dec.value).toBe(plaintext);
    }
  });

  it("two encryptions of the same plaintext differ (random IV)", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const a = await seal(provider, KEY_REF, TOKEN);
    const b = await seal(provider, KEY_REF, TOKEN);
    expect(a).not.toBe(b);
  });
});

describe("crypto — decrypt failure modes (Result, no throw, no leak)", () => {
  it("tampered ciphertext fails authentication", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const sealed = await seal(provider, KEY_REF, TOKEN);
    const [v, iv, ct, tag] = sealed.split(".");
    const ctBytes = Buffer.from(ct ?? "", "base64");
    ctBytes[0] = ctBytes[0] === undefined ? 0 : ctBytes[0] ^ 0xff;
    const tampered = [v, iv, ctBytes.toString("base64"), tag].join(".");

    const error = decryptError(await decryptToken(provider, KEY_REF, tampered));
    expect(error.code).toBe(CryptoErrorCode.AUTHENTICATION_FAILED);
    expect(error.message).not.toContain(TOKEN);
  });

  it("tampered auth tag fails authentication", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const sealed = await seal(provider, KEY_REF, TOKEN);
    const [v, iv, ct, tag] = sealed.split(".");
    const tagBytes = Buffer.from(tag ?? "", "base64");
    tagBytes[0] = tagBytes[0] === undefined ? 0 : tagBytes[0] ^ 0xff;
    const tampered = [v, iv, ct, tagBytes.toString("base64")].join(".");

    const error = decryptError(await decryptToken(provider, KEY_REF, tampered));
    expect(error.code).toBe(CryptoErrorCode.AUTHENTICATION_FAILED);
  });

  it("wrong key fails authentication", async () => {
    const sealed = await seal(
      providerWith({ [KEY_REF]: freshKeyB64() }),
      KEY_REF,
      TOKEN,
    );
    // Same keyRef, different key material behind it.
    const decProvider = providerWith({ [KEY_REF]: freshKeyB64() });
    const error = decryptError(
      await decryptToken(decProvider, KEY_REF, sealed),
    );
    expect(error.code).toBe(CryptoErrorCode.AUTHENTICATION_FAILED);
  });

  it("unknown version prefix is rejected", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const sealed = await seal(provider, KEY_REF, TOKEN);
    const withV2 = sealed.replace(/^v1\./, "v2.");
    const error = decryptError(await decryptToken(provider, KEY_REF, withV2));
    expect(error.code).toBe(CryptoErrorCode.UNKNOWN_VERSION);
  });

  it("structurally malformed input is rejected", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const accepted = [
      CryptoErrorCode.MALFORMED_CIPHERTEXT,
      CryptoErrorCode.UNKNOWN_VERSION,
    ];
    for (const bad of [
      "",
      "v1",
      "v1.aaa",
      "v1.a.b",
      "not-even-close",
      "v1.....",
    ]) {
      const error = decryptError(await decryptToken(provider, KEY_REF, bad));
      expect(accepted).toContain(error.code);
    }
  });

  it("unresolvable key surfaces keyUnavailable with a cause", async () => {
    const sealed = await seal(
      providerWith({ [KEY_REF]: freshKeyB64() }),
      KEY_REF,
      TOKEN,
    );
    const error = decryptError(
      await decryptToken(providerWith({}), KEY_REF, sealed),
    );
    expect(error.code).toBe(CryptoErrorCode.KEY_UNAVAILABLE);
    expect(error.cause?.code).toBe(KeyErrorCode.MISSING);
  });

  it("key rotation: a v2 keyRef decrypts its own ciphertext, not v1's", async () => {
    // Two keys live side by side; key_ref on the row selects which.
    const provider = providerWith({
      [KEY_REF]: freshKeyB64(),
      [OTHER_KEY_REF]: freshKeyB64(),
    });
    const sealedV1 = await seal(provider, KEY_REF, TOKEN);
    const sealedV2 = await seal(provider, OTHER_KEY_REF, TOKEN);

    const okV1 = await decryptToken(provider, KEY_REF, sealedV1);
    const okV2 = await decryptToken(provider, OTHER_KEY_REF, sealedV2);
    expect(okV1.ok && okV2.ok).toBe(true);

    // Wrong key_ref for the ciphertext → auth failure.
    const error = decryptError(
      await decryptToken(provider, OTHER_KEY_REF, sealedV1),
    );
    expect(error.code).toBe(CryptoErrorCode.AUTHENTICATION_FAILED);
  });
});
