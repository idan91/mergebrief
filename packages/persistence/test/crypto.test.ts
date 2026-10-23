// Token-crypto tests. Cover the security gates: round-trip, tamper/wrong-key
// auth failure (Result, no throw, no key material leaked), key env validation,
// IV randomness, version rejection, and the row/column/key-ref binding. Result
// narrowing uses the repo's `if (!x.ok) throw` pattern so no `expect` is
// conditional.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CryptoErrorCodes,
  KeyErrorCodes,
  decryptToken,
  encryptToken,
  createEnvKeyProvider,
  type CryptoError,
  type KeyProvider,
} from "../src/auth/crypto";
import { GrantSealedColumns, type GrantSealBinding } from "../src/auth/types";
import { isGrantRowId } from "../src/types";
import type { Result } from "types/utils";
import { brandWith } from "./helpers";

const KEY_REF = "SESSION_KEY_V1";
const OTHER_KEY_REF = "SESSION_KEY_V2";
const TOKEN = "gho_16C7e42F292c6912E7710c838347Ae178B4a"; // shape of a GitHub token
const ACCESS_BINDING: GrantSealBinding = {
  grantId: brandWith(isGrantRowId, 41n),
  column: GrantSealedColumns.ACCESS_TOKEN,
};

/** A base64 32-byte key. */
function freshKeyB64(): string {
  return randomBytes(32).toString("base64");
}

/** Env-backed provider with the given key vars set. */
function providerWith(vars: Record<string, string>): KeyProvider {
  return createEnvKeyProvider(vars);
}

/** Unwrap a successful encrypt or fail the test loudly. */
async function seal(
  provider: KeyProvider,
  keyRef: string,
  plaintext: string,
  binding: GrantSealBinding = ACCESS_BINDING,
): Promise<string> {
  const enc = await encryptToken(provider, keyRef, plaintext, binding);
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

describe("crypto: createEnvKeyProvider", () => {
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
    if (result.ok) {
      throw new Error("expected missing");
    }
    expect(result.error.code).toBe(KeyErrorCodes.MISSING);
  });

  it("empty env var → missing error", async () => {
    const result = await providerWith({ [KEY_REF]: "" }).resolveKey(KEY_REF);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected missing");
    }
    expect(result.error.code).toBe(KeyErrorCodes.MISSING);
  });

  it("non-base64 env var → malformed error", async () => {
    const result = await providerWith({
      [KEY_REF]: "not valid base64 !!!",
    }).resolveKey(KEY_REF);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected malformed");
    }
    expect(result.error.code).toBe(KeyErrorCodes.MALFORMED);
  });

  it("rejects a key that is not 32 bytes with wrongLength", async () => {
    const short = randomBytes(16).toString("base64");
    const result = await providerWith({ [KEY_REF]: short }).resolveKey(KEY_REF);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected wrongLength");
    }
    expect(result.error.code).toBe(KeyErrorCodes.WRONG_LENGTH);
  });

  it("no error message contains the key value", async () => {
    const short = randomBytes(30).toString("base64");
    const result = await providerWith({ [KEY_REF]: short }).resolveKey(KEY_REF);
    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected wrongLength");
    }
    expect(result.error.message).not.toContain(short);
  });
});

describe("crypto: encrypt/decrypt round-trip", () => {
  it("decrypts what it encrypted", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const sealed = await seal(provider, KEY_REF, TOKEN);
    expect(sealed.startsWith("v2.")).toBe(true);

    const dec = await decryptToken(provider, KEY_REF, sealed, ACCESS_BINDING);
    if (!dec.ok) {
      throw new Error("expected decrypt to succeed");
    }
    expect(dec.value).toBe(TOKEN);
  });

  it("round-trips unicode and long tokens", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    for (const plaintext of ["ünïcödé-🔑-token", "x".repeat(4096)]) {
      const sealed = await seal(provider, KEY_REF, plaintext);
      const dec = await decryptToken(provider, KEY_REF, sealed, ACCESS_BINDING);
      if (!dec.ok) {
        throw new Error("expected decrypt to succeed");
      }
      expect(dec.value).toBe(plaintext);
    }
  });

  it("gives two encryptions of the same plaintext different random IVs", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const a = await seal(provider, KEY_REF, TOKEN);
    const b = await seal(provider, KEY_REF, TOKEN);
    expect(a).not.toBe(b);
  });
});

describe("crypto: decrypt fails as a Result, with no throw and no leak", () => {
  it("tampered ciphertext fails authentication", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const sealed = await seal(provider, KEY_REF, TOKEN);
    const [v, iv, ct, tag] = sealed.split(".");
    const ctBytes = Buffer.from(ct ?? "", "base64");
    ctBytes[0] = ctBytes[0] === undefined ? 0 : ctBytes[0] ^ 0xff;
    const tampered = [v, iv, ctBytes.toString("base64"), tag].join(".");

    const error = decryptError(
      await decryptToken(provider, KEY_REF, tampered, ACCESS_BINDING),
    );
    expect(error.code).toBe(CryptoErrorCodes.AUTHENTICATION_FAILED);
    expect(error.message).not.toContain(TOKEN);
  });

  it("tampered auth tag fails authentication", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const sealed = await seal(provider, KEY_REF, TOKEN);
    const [v, iv, ct, tag] = sealed.split(".");
    const tagBytes = Buffer.from(tag ?? "", "base64");
    tagBytes[0] = tagBytes[0] === undefined ? 0 : tagBytes[0] ^ 0xff;
    const tampered = [v, iv, ct, tagBytes.toString("base64")].join(".");

    const error = decryptError(
      await decryptToken(provider, KEY_REF, tampered, ACCESS_BINDING),
    );
    expect(error.code).toBe(CryptoErrorCodes.AUTHENTICATION_FAILED);
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
      await decryptToken(decProvider, KEY_REF, sealed, ACCESS_BINDING),
    );
    expect(error.code).toBe(CryptoErrorCodes.AUTHENTICATION_FAILED);
  });

  it("a v1 ciphertext is an unknown version", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const sealed = await seal(provider, KEY_REF, TOKEN);
    const asV1 = sealed.replace(/^v2\./, "v1.");
    const error = decryptError(
      await decryptToken(provider, KEY_REF, asV1, ACCESS_BINDING),
    );
    expect(error.code).toBe(CryptoErrorCodes.UNKNOWN_VERSION);
  });

  it("structurally malformed input is rejected", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const accepted = [
      CryptoErrorCodes.MALFORMED_CIPHERTEXT,
      CryptoErrorCodes.UNKNOWN_VERSION,
    ];
    for (const bad of [
      "",
      "v2",
      "v2.aaa",
      "v2.a.b",
      "not-even-close",
      "v2.....",
    ]) {
      const error = decryptError(
        await decryptToken(provider, KEY_REF, bad, ACCESS_BINDING),
      );
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
      await decryptToken(providerWith({}), KEY_REF, sealed, ACCESS_BINDING),
    );
    expect(error.code).toBe(CryptoErrorCodes.KEY_UNAVAILABLE);
    expect(error.cause?.code).toBe(KeyErrorCodes.MISSING);
  });

  it("key rotation: a v2 keyRef decrypts its own ciphertext, not v1's", async () => {
    // Two keys live side by side; key_ref on the row selects which.
    const provider = providerWith({
      [KEY_REF]: freshKeyB64(),
      [OTHER_KEY_REF]: freshKeyB64(),
    });
    const sealedV1 = await seal(provider, KEY_REF, TOKEN);
    const sealedV2 = await seal(provider, OTHER_KEY_REF, TOKEN);

    const okV1 = await decryptToken(
      provider,
      KEY_REF,
      sealedV1,
      ACCESS_BINDING,
    );
    const okV2 = await decryptToken(
      provider,
      OTHER_KEY_REF,
      sealedV2,
      ACCESS_BINDING,
    );
    expect(okV1.ok && okV2.ok).toBe(true);

    // Wrong key_ref for the ciphertext → auth failure.
    const error = decryptError(
      await decryptToken(provider, OTHER_KEY_REF, sealedV1, ACCESS_BINDING),
    );
    expect(error.code).toBe(CryptoErrorCodes.AUTHENTICATION_FAILED);
  });
});

describe("crypto: a ciphertext opens only where it was sealed", () => {
  it("fails under another grant id", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const sealed = await seal(provider, KEY_REF, TOKEN);
    const otherRow: GrantSealBinding = {
      ...ACCESS_BINDING,
      grantId: brandWith(isGrantRowId, 42n),
    };

    const error = decryptError(
      await decryptToken(provider, KEY_REF, sealed, otherRow),
    );
    expect(error.code).toBe(CryptoErrorCodes.AUTHENTICATION_FAILED);
    expect(error.message).not.toContain(TOKEN);
  });

  it("fails when read as the other column", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const sealed = await seal(provider, KEY_REF, TOKEN);
    const refreshColumn: GrantSealBinding = {
      ...ACCESS_BINDING,
      column: GrantSealedColumns.REFRESH_TOKEN,
    };

    const error = decryptError(
      await decryptToken(provider, KEY_REF, sealed, refreshColumn),
    );
    expect(error.code).toBe(CryptoErrorCodes.AUTHENTICATION_FAILED);
    expect(error.message).not.toContain(TOKEN);
  });

  it("fails under another key ref holding the same key bytes", async () => {
    const keyBytes = freshKeyB64();
    const provider = providerWith({
      [KEY_REF]: keyBytes,
      [OTHER_KEY_REF]: keyBytes,
    });
    const sealed = await seal(provider, KEY_REF, TOKEN);

    const error = decryptError(
      await decryptToken(provider, OTHER_KEY_REF, sealed, ACCESS_BINDING),
    );
    expect(error.code).toBe(CryptoErrorCodes.AUTHENTICATION_FAILED);
    expect(error.message).not.toContain(TOKEN);
  });

  it("opens the refresh column under its own binding", async () => {
    const provider = providerWith({ [KEY_REF]: freshKeyB64() });
    const refreshColumn: GrantSealBinding = {
      ...ACCESS_BINDING,
      column: GrantSealedColumns.REFRESH_TOKEN,
    };
    const sealed = await seal(provider, KEY_REF, TOKEN, refreshColumn);

    const opened = await decryptToken(provider, KEY_REF, sealed, refreshColumn);
    if (!opened.ok) {
      throw new Error("expected decrypt to succeed");
    }
    expect(opened.value).toBe(TOKEN);
  });
});
