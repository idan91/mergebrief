// Webhook HMAC verification (BRIEF-2 stage 2). Delegates the actual signature
// check to `@octokit/webhooks-methods` `verify`, which does a CONSTANT-TIME
// comparison of the `sha256=…` HMAC — this module never hand-rolls the crypto
// (AGENTS.md invariant). The verified subject is the RAW request-body string:
// callers MUST pass the exact bytes GitHub signed, before any JSON re-encode.
import { verify } from "@octokit/webhooks-methods";
import type { Result, ValueOf } from "../types";

export const WebhookVerifyErrorCode = {
  MISSING_SIGNATURE: "missing-signature",
  INVALID_SIGNATURE: "invalid-signature",
} as const;
export type WebhookVerifyErrorCode = ValueOf<typeof WebhookVerifyErrorCode>;

export interface WebhookVerifyError {
  readonly code: WebhookVerifyErrorCode;
  /** Sanitized reason. Never carries the secret, the payload bytes, or the signature. */
  readonly message: string;
}

export interface VerifyWebhookSignatureInput {
  /** The configured webhook secret (`GITHUB_WEBHOOK_SECRET`). */
  readonly secret: string;
  /** The RAW request body exactly as received (the bytes GitHub signed). */
  readonly payload: string;
  /** The `x-hub-signature-256` header value (`sha256=…`), or a falsy value if absent. */
  readonly signature: string | undefined;
}

/**
 * Verify an inbound webhook's `x-hub-signature-256` against the raw body.
 * Returns `ok` on a genuine match, `MISSING_SIGNATURE` when the header is
 * absent/empty, and `INVALID_SIGNATURE` for both a mismatch and a
 * malformed signature (a replayed signature against a different body is just
 * the mismatch case). Never throws for these expected failures; never echoes
 * secret or payload material.
 */
export async function verifyWebhookSignature(
  input: VerifyWebhookSignatureInput,
): Promise<Result<void, WebhookVerifyError>> {
  const { secret, payload, signature } = input;

  if (signature === undefined || signature.trim() === "") {
    return {
      ok: false,
      error: {
        code: WebhookVerifyErrorCode.MISSING_SIGNATURE,
        message: "missing x-hub-signature-256 header",
      },
    };
  }

  let matches: boolean;
  try {
    matches = await verify(secret, payload, signature);
  } catch {
    // `verify` throws on a malformed signature (e.g. missing the `sha256=`
    // prefix). That is not a programmer error — it's untrusted input — so it
    // maps to an expected `Result`, not a throw. The thrown error is
    // deliberately discarded (it may quote the signature bytes).
    return {
      ok: false,
      error: {
        code: WebhookVerifyErrorCode.INVALID_SIGNATURE,
        message: "webhook signature is malformed or does not match the payload",
      },
    };
  }

  if (!matches) {
    return {
      ok: false,
      error: {
        code: WebhookVerifyErrorCode.INVALID_SIGNATURE,
        message: "webhook signature does not match the payload",
      },
    };
  }

  return { ok: true, value: undefined };
}
