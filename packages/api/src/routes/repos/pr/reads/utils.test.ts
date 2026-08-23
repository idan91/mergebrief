import { Hono } from "hono";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { ApiErrorCodes } from "../../../../error-response";
import { BadRequest } from "../../../../shared-errors/api-error";
import type { AuthzEnv } from "../../../authz";
import { parseQuery, parsePrNumber } from "./utils";

const schema = z.object({ base: z.string().min(1), head: z.string().min(1) });

async function driveQuery(path: string): Promise<Response> {
  const app = new Hono<AuthzEnv>();
  app.get("/probe", (c) => {
    const parsed = parseQuery(c, schema, ["base", "head"]);
    return c.json(parsed);
  });
  return await app.request(path);
}

async function drivePrNumber(prNumber: string): Promise<Response> {
  const app = new Hono<AuthzEnv>();
  app.get("/:prNumber", (c) => c.json({ prNumber: parsePrNumber(c) }));
  return await app.request(`/${prNumber}`);
}

describe("parseQuery", () => {
  it("returns the parsed shape when every key is present", async () => {
    const response = await driveQuery("/probe?base=a&head=b");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ base: "a", head: "b" });
  });

  it("throws the deterministic 400 when a key is missing", async () => {
    const app = new Hono<AuthzEnv>();
    let thrown: unknown;
    app.get("/probe", (c) => {
      try {
        parseQuery(c, schema, ["base", "head"]);
      } catch (error) {
        thrown = error;
      }
      return c.body(null, 204);
    });
    await app.request("/probe?base=a");
    expect(thrown).toBeInstanceOf(BadRequest);
    expect(thrown instanceof BadRequest && thrown.code).toBe(
      ApiErrorCodes.INVALID_REQUEST,
    );
  });
});

describe("parsePrNumber", () => {
  it("returns the number for a valid param", async () => {
    const response = await drivePrNumber("42");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ prNumber: 42 });
  });

  it("throws the deterministic 400 for a non-numeric param", async () => {
    const app = new Hono<AuthzEnv>();
    let thrown: unknown;
    app.get("/:prNumber", (c) => {
      try {
        parsePrNumber(c);
      } catch (error) {
        thrown = error;
      }
      return c.body(null, 204);
    });
    await app.request("/not-a-number");
    expect(thrown).toBeInstanceOf(BadRequest);
    expect(thrown instanceof BadRequest && thrown.code).toBe(
      ApiErrorCodes.INVALID_REQUEST,
    );
  });
});
