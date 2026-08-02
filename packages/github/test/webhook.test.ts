// HMAC verification vectors. A valid signature is computed with
// `@octokit/webhooks-methods` `sign` (the counterpart to the `verify` under
// test), then we assert genuine match, body tamper, signature tamper, replay
// (same signature vs. a different body), and a missing header. No secret or
// payload bytes should ever appear in an error.
import { sign } from "@octokit/webhooks-methods";
import { describe, expect, it } from "vitest";
import {
  verifyWebhookSignature,
  WebhookVerifyErrorCode,
} from "../src/webhook/verify";

const SECRET = "it's a secret to everybody";
const PAYLOAD = JSON.stringify({ action: "opened", number: 7 });
const OTHER_PAYLOAD = JSON.stringify({ action: "opened", number: 8 });

describe("verifyWebhookSignature", () => {
  it("accepts a signature that matches the payload", async () => {
    const signature = await sign(SECRET, PAYLOAD);
    const result = await verifyWebhookSignature({
      secret: SECRET,
      payload: PAYLOAD,
      signature,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a tampered body with INVALID_SIGNATURE", async () => {
    const signature = await sign(SECRET, PAYLOAD);
    const result = await verifyWebhookSignature({
      secret: SECRET,
      payload: `${PAYLOAD} `, // one extra byte
      signature,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(WebhookVerifyErrorCode.INVALID_SIGNATURE);
  });

  it("rejects a replayed signature against a different body (INVALID_SIGNATURE)", async () => {
    const signature = await sign(SECRET, PAYLOAD);
    const result = await verifyWebhookSignature({
      secret: SECRET,
      payload: OTHER_PAYLOAD,
      signature,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(WebhookVerifyErrorCode.INVALID_SIGNATURE);
  });

  it("rejects a tampered signature with INVALID_SIGNATURE", async () => {
    const signature = await sign(SECRET, PAYLOAD);
    // Flip the last hex char.
    const tampered =
      signature.slice(0, -1) + (signature.endsWith("0") ? "1" : "0");
    const result = await verifyWebhookSignature({
      secret: SECRET,
      payload: PAYLOAD,
      signature: tampered,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(WebhookVerifyErrorCode.INVALID_SIGNATURE);
  });

  it("rejects a malformed signature (no sha256= prefix) with INVALID_SIGNATURE", async () => {
    const result = await verifyWebhookSignature({
      secret: SECRET,
      payload: PAYLOAD,
      signature: "not-a-real-signature",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(WebhookVerifyErrorCode.INVALID_SIGNATURE);
  });

  it("reports MISSING_SIGNATURE when the header is absent", async () => {
    const result = await verifyWebhookSignature({
      secret: SECRET,
      payload: PAYLOAD,
      signature: undefined,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(WebhookVerifyErrorCode.MISSING_SIGNATURE);
  });

  it("reports MISSING_SIGNATURE for an empty/whitespace header", async () => {
    const result = await verifyWebhookSignature({
      secret: SECRET,
      payload: PAYLOAD,
      signature: "   ",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.code).toBe(WebhookVerifyErrorCode.MISSING_SIGNATURE);
  });

  it("never echoes the secret or payload in an error message", async () => {
    const signature = await sign(SECRET, PAYLOAD);
    const result = await verifyWebhookSignature({
      secret: SECRET,
      payload: OTHER_PAYLOAD,
      signature,
    });
    if (result.ok) throw new Error("unreachable");
    expect(result.error.message).not.toContain(SECRET);
    expect(result.error.message).not.toContain(OTHER_PAYLOAD);
  });
});
