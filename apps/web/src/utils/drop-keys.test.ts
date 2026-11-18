import { describe, expect, it } from "vitest";
import { z } from "zod/v4";

import { dropInvalidKeys, dropNullKeys } from "./drop-keys";

const AuthorSchema = dropNullKeys(
  z.object({
    login: z.string(),
    name: z.string().exactOptional(),
  }),
  ["name"],
);

describe("dropNullKeys", () => {
  it("parses a listed key carrying null as absent", () => {
    const parsed = AuthorSchema.parse({ login: "octocat", name: null });

    expect(parsed).toEqual({ login: "octocat" });
    expect(Object.hasOwn(parsed, "name")).toBe(false);
  });

  it("keeps a listed key that carries a value", () => {
    expect(AuthorSchema.parse({ login: "octocat", name: "Mona" })).toEqual({
      login: "octocat",
      name: "Mona",
    });
  });

  it("still fails a null on a key that is not listed", () => {
    expect(AuthorSchema.safeParse({ login: null }).success).toBe(false);
  });

  it("never lets a __proto__ key change the parsed object's prototype", () => {
    const body: unknown = JSON.parse(
      '{"login":"octocat","__proto__":{"name":"injected"}}',
    );

    const parsed = AuthorSchema.parse(body);

    expect(parsed).toEqual({ login: "octocat" });
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });
});

const AvatarSchema = dropInvalidKeys(
  z.object({
    login: z.string(),
    avatarUrl: z.string().startsWith("https://").exactOptional(),
  }),
  ["avatarUrl"],
);

describe("dropInvalidKeys", () => {
  it("drops a listed key its field schema rejects and keeps the object", () => {
    const parsed = AvatarSchema.parse({
      login: "octocat",
      avatarUrl: "http://insecure.example/a.png",
    });

    expect(parsed).toEqual({ login: "octocat" });
    expect(Object.hasOwn(parsed, "avatarUrl")).toBe(false);
  });

  it("drops a listed key of the wrong type", () => {
    expect(AvatarSchema.parse({ login: "octocat", avatarUrl: 7 })).toEqual({
      login: "octocat",
    });
  });

  it("keeps a listed key its field schema accepts", () => {
    const body = { login: "octocat", avatarUrl: "https://cdn.example/a.png" };

    expect(AvatarSchema.parse(body)).toEqual(body);
  });

  it("still fails an invalid key that is not listed", () => {
    expect(AvatarSchema.safeParse({ login: 7 }).success).toBe(false);
  });
});

describe("drop-keys nesting", () => {
  const Nested = dropInvalidKeys(
    dropNullKeys(
      z.object({
        login: z.string(),
        name: z.string().exactOptional(),
        role: z.enum(["admin", "member"]).exactOptional(),
      }),
      ["name"],
    ),
    ["role"],
  );

  it("drops a null on the null-listed key and a bad value on the other", () => {
    const parsed = Nested.parse({
      login: "octocat",
      name: null,
      role: "owner",
    });

    expect(parsed).toStrictEqual({ login: "octocat" });
  });

  it("keeps the strict read on every other key", () => {
    expect(Nested.safeParse({ login: "octocat", name: 7 }).success).toBe(false);
    expect(Nested.safeParse({ login: null }).success).toBe(false);
  });
});

describe("drop-keys object gate", () => {
  const OptionalOnly = dropNullKeys(
    z.object({ name: z.string().exactOptional() }),
    ["name"],
  );

  it("leaves an array or null for the object schema to refuse", () => {
    expect(OptionalOnly.safeParse([]).success).toBe(false);
    expect(OptionalOnly.safeParse(null).success).toBe(false);
    expect(OptionalOnly.safeParse({ name: null }).success).toBe(true);
  });

  it("drops listed keys on a null-prototype record", () => {
    const record: Record<string, unknown> = Object.create(null);
    record["name"] = null;

    expect(OptionalOnly.parse(record)).toStrictEqual({});
  });

  it("leaves an array for dropInvalidKeys' object schema to refuse", () => {
    const InvalidOnly = dropInvalidKeys(
      z.object({ name: z.string().exactOptional() }),
      ["name"],
    );

    expect(InvalidOnly.safeParse([]).success).toBe(false);
  });
});
