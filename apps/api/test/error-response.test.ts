import { Hono, type Context } from "hono";
import { describe, expect, it } from "vitest";
import {
  ApiErrorCodes,
  ApiErrorEnglishByCode,
  ApiErrorStatusByCode,
} from "contract";
import { errorJson } from "../src/error-response";

function appFor(handler: (c: Context) => Response): Hono {
  const app = new Hono();
  app.get("/probe", (c) => handler(c));
  return app;
}

describe("errorJson", () => {
  it("emits { error, code } with the code's mapped status and no-store", async () => {
    const app = appFor((c) => errorJson(c, ApiErrorCodes.NOT_FOUND));
    const res = await app.request("/probe");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "not found", code: "not-found" });
  });

  it("composes the English line from the template and carries params", async () => {
    const app = appFor((c) =>
      errorJson(c, ApiErrorCodes.GENERATION_CONFIG, {
        detail: "missing ANTHROPIC_API_KEY",
      }),
    );
    const res = await app.request("/probe");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "missing ANTHROPIC_API_KEY",
      code: "generation-config",
      params: { detail: "missing ANTHROPIC_API_KEY" },
    });
  });

  it("omits params entirely for paramless codes", async () => {
    const app = appFor((c) => errorJson(c, ApiErrorCodes.UNAUTHORIZED));
    const body: unknown = await (await app.request("/probe")).json();
    expect(body).not.toHaveProperty("params");
  });

  it("maps every code to exactly one status and one template", () => {
    const codes = Object.values(ApiErrorCodes);
    expect(codes).toHaveLength(37);
    for (const code of codes) {
      expect(ApiErrorStatusByCode[code]).toBeGreaterThanOrEqual(400);
      expect(ApiErrorEnglishByCode[code]).toBeTruthy();
    }
  });

  it("pins the full code to status table, a flip is a contract decision", () => {
    expect(ApiErrorStatusByCode).toEqual({
      unauthorized: 401,
      "invalid-signature": 401,
      forbidden: 403,
      "github-permission": 403,
      "scope-exceeded": 403,
      "human-only": 403,
      "no-repo-write-access": 403,
      "repo-admin-only": 403,
      "attachments-disabled": 403,
      "attachments-admin-only": 403,
      "not-found": 404,
      "invalid-request": 400,
      "attachment-unsupported-type": 400,
      "not-a-pr-url": 400,
      "sign-in-failed": 400,
      "request-too-large": 413,
      "diff-too-large": 413,
      "file-not-found": 404,
      "file-too-large": 413,
      "file-not-text": 400,
      "draft-already-published": 409,
      "draft-anchor-orphaned": 409,
      "draft-limit-reached": 409,
      "session-record-limit-reached": 409,
      "draft-publish-pending": 409,
      "draft-publish-in-doubt": 409,
      "attachment-limit-reached": 429,
      "pending-review-held": 409,
      "pr-changed-since-read": 409,
      "pr-rewritten-since-read": 409,
      "app-not-installed": 403,
      "github-unavailable": 502,
      "generation-failed": 502,
      "generation-unavailable": 503,
      "generation-config": 503,
      "artifact-unreadable": 500,
      "internal-error": 500,
    });
  });
});
