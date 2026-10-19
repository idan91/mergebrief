// The payload boundary: both worlds parse into branded inputs; malformed
// payloads drop. A payload carrying BOTH worlds' keys resolves as the
// installation branch (union order), pinned below so the precedence is a
// choice, not an accident.
import { describe, expect, it } from "vitest";
import {
  parseGeneratePayload,
  readPayloadTraceparent,
  TRACEPARENT_MAX_LENGTH,
} from "../src/task/payload";

describe("parseGeneratePayload", () => {
  it("parses an installation payload into a tenant ctx with no grant", () => {
    const parsed = parseGeneratePayload({
      installation_id: "42",
      pull_request_id: "7",
      head_sha: "a".repeat(40),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("expected success");
    }
    expect(parsed.value.ctx).toEqual({ installationId: 42n });
    expect(parsed.value.grantId).toBeUndefined();
    expect(parsed.value.pullRequestId).toBe(7n);
  });

  it("parses a url-box payload into an owner ctx carrying the grant", () => {
    const parsed = parseGeneratePayload({
      owner_user_id: "555",
      grant_id: "31",
      pull_request_id: "7",
      head_sha: "a".repeat(40),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("expected success");
    }
    expect(parsed.value.ctx).toEqual({ ownerUserId: 555n });
    expect(parsed.value.grantId).toBe(31n);
  });

  it("a payload naming both worlds resolves as the installation branch", () => {
    const parsed = parseGeneratePayload({
      installation_id: "42",
      owner_user_id: "555",
      grant_id: "31",
      pull_request_id: "7",
      head_sha: "a".repeat(40),
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      throw new Error("expected success");
    }
    expect(parsed.value.ctx).toEqual({ installationId: 42n });
    expect(parsed.value.grantId).toBeUndefined();
  });

  it("rejects an owner payload missing its grant reference", () => {
    expect(
      parseGeneratePayload({
        owner_user_id: "555",
        pull_request_id: "7",
        head_sha: "a".repeat(40),
      }).ok,
    ).toBe(false);
  });

  it("rejects non-numeric ids and empty heads", () => {
    expect(
      parseGeneratePayload({
        installation_id: "abc",
        pull_request_id: "7",
        head_sha: "x",
      }).ok,
    ).toBe(false);
    expect(
      parseGeneratePayload({
        owner_user_id: "555",
        grant_id: "0",
        pull_request_id: "7",
        head_sha: "x",
      }).ok,
    ).toBe(false);
    expect(
      parseGeneratePayload({
        installation_id: "42",
        pull_request_id: "7",
        head_sha: "",
      }).ok,
    ).toBe(false);
  });
});

describe("readPayloadTraceparent", () => {
  const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

  it("reads the enqueue's traceparent beside the job fields", () => {
    const payload = {
      installation_id: "42",
      pull_request_id: "7",
      head_sha: "a",
      traceparent: TRACEPARENT,
    };
    expect(readPayloadTraceparent(payload)).toBe(TRACEPARENT);
    expect(parseGeneratePayload(payload).ok).toBe(true);
  });

  it("is absent for a missing, foreign or oversized value", () => {
    expect(readPayloadTraceparent({ installation_id: "42" })).toBeUndefined();
    expect(readPayloadTraceparent({ traceparent: 7 })).toBeUndefined();
    const oversized = "x".repeat(TRACEPARENT_MAX_LENGTH + 1);
    expect(readPayloadTraceparent({ traceparent: oversized })).toBeUndefined();
    expect(readPayloadTraceparent(undefined)).toBeUndefined();
  });

  it("leaves a malformed traceparent unable to drop the job", () => {
    const payload = {
      installation_id: "42",
      pull_request_id: "7",
      head_sha: "a",
      traceparent: 7,
    };
    expect(parseGeneratePayload(payload).ok).toBe(true);
  });
});
