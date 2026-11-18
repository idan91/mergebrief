// Webhook HMAC verification. `@octokit/webhooks-methods` does a CONSTANT-TIME
// comparison of the `sha256=…` HMAC; the crypto is never hand-rolled here. The
// verified subject is the RAW request body: callers MUST pass the exact bytes
// GitHub signed, before any JSON re-encode.
import { verify } from "@octokit/webhooks-methods";
import type { Result, ValueOf } from "types/utils";

export const WebhookVerifyErrorCodes = {
  MISSING_SIGNATURE: "missing-signature",
  INVALID_SIGNATURE: "invalid-signature",
} as const;
export type WebhookVerifyErrorCode = ValueOf<typeof WebhookVerifyErrorCodes>;

export interface WebhookVerifyError {
  readonly code: WebhookVerifyErrorCode;
  /** Sanitized reason. Never carries the secret, the payload bytes, or the signature. */
  readonly message: string;
}

export interface VerifyWebhookSignatureInput {
  readonly secret: string;
  /** The RAW request body exactly as received: the bytes GitHub signed. */
  readonly payload: string;
  /** The `x-hub-signature-256` header value (`sha256=…`). */
  readonly signature: string | undefined;
}

/**
 * Verify an inbound webhook's `x-hub-signature-256` against the raw body. A
 * mismatch and a malformed signature both map to `INVALID_SIGNATURE`. Never
 * echoes secret or payload material.
 */
export async function verifyWebhookSignature(
  input: VerifyWebhookSignatureInput,
): Promise<Result<void, WebhookVerifyError>> {
  const { secret, payload, signature } = input;

  if (signature === undefined || signature.trim() === "") {
    return {
      ok: false,
      error: {
        code: WebhookVerifyErrorCodes.MISSING_SIGNATURE,
        message: "missing x-hub-signature-256 header",
      },
    };
  }

  let matches: boolean;
  try {
    matches = await verify(secret, payload, signature);
  } catch {
    // `verify` throws on a malformed signature: untrusted input, so an
    // expected `Result`. The thrown error may quote the signature bytes, so it
    // is discarded.
    return {
      ok: false,
      error: {
        code: WebhookVerifyErrorCodes.INVALID_SIGNATURE,
        message: "webhook signature is malformed or does not match the payload",
      },
    };
  }

  if (!matches) {
    return {
      ok: false,
      error: {
        code: WebhookVerifyErrorCodes.INVALID_SIGNATURE,
        message: "webhook signature does not match the payload",
      },
    };
  }

  return { ok: true, value: undefined };
}
