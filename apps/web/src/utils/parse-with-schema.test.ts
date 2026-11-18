import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { parseWithSchema } from "./parse-with-schema";

const ViewerSchema = z.object({
  login: z.string(),
  repos: z.array(z.object({ id: z.number() })),
});

describe("parseWithSchema", () => {
  it("returns the parsed value on success", () => {
    const body = { login: "octocat", repos: [{ id: 1 }] };

    expect(parseWithSchema(ViewerSchema, body)).toEqual({
      ok: true,
      value: body,
    });
  });

  it("names the first failing issue by its dotted path", () => {
    const body = { login: "octocat", repos: [{ id: 1 }, { id: "two" }] };

    expect(parseWithSchema(ViewerSchema, body)).toEqual({
      ok: false,
      error: "repos.1.id: Invalid input: expected number, received string",
    });
  });

  it("reports a root-level failure without a path prefix", () => {
    expect(parseWithSchema(ViewerSchema, "not an object")).toEqual({
      ok: false,
      error: "Invalid input: expected object, received string",
    });
  });
});
