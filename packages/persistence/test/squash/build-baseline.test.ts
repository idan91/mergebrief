// A normalized dump becomes one drizzle migration: statements split on a
// terminating semicolon and joined by the breakpoint marker drizzle's
// migrator and PGlite both split on.
import { describe, expect, it } from "vitest";
import {
  buildBaselineSql,
  splitDumpStatements,
} from "../../scripts/squash/logic/build-baseline";

const CREATE_TABLE = [
  "CREATE TABLE public.webhook_delivery (",
  "    signature_digest text NOT NULL,",
  "    CONSTRAINT webhook_delivery_signature_digest_shape CHECK ((signature_digest ~ '^[0-9a-f]{64}$'::text))",
  ");",
].join("\n");

const ADD_IDENTITY = [
  "ALTER TABLE public.api_token ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (",
  "    SEQUENCE NAME public.api_token_id_seq",
  "    START WITH 1",
  "    CACHE 1",
  ");",
].join("\n");

const CREATE_INDEX =
  "CREATE INDEX api_token_grant_idx ON public.api_token USING btree (grant_id);";

describe("splitDumpStatements", () => {
  it("splits multi-line statements on a semicolon at line end", () => {
    const normalized = `${CREATE_TABLE}\n${ADD_IDENTITY}\n${CREATE_INDEX}\n`;

    expect(splitDumpStatements(normalized)).toEqual({
      ok: true,
      value: [CREATE_TABLE, ADD_IDENTITY, CREATE_INDEX],
    });
  });

  it("keeps a semicolon inside a CHECK string literal with the statement", () => {
    const check =
      "CREATE TABLE public.t (\n    c text,\n    CONSTRAINT c_shape CHECK ((c ~ '^a;'::text))\n);";

    expect(splitDumpStatements(`${check}\n`)).toEqual({
      ok: true,
      value: [check],
    });
  });

  it("refuses a dollar-quoted body", () => {
    const body =
      "CREATE FUNCTION public.f() RETURNS void LANGUAGE sql AS $$\nselect 1;\n$$;\n";

    expect(splitDumpStatements(body)).toEqual({
      ok: false,
      error: expect.stringMatching(/dollar-quoted/),
    });
  });

  it("refuses text left after the last semicolon", () => {
    expect(splitDumpStatements(`${CREATE_INDEX}\nCREATE INDEX x`)).toEqual({
      ok: false,
      error: expect.stringMatching(/unterminated/),
    });
  });
});

describe("buildBaselineSql", () => {
  it("puts a breakpoint between statements and none after the last", () => {
    expect(buildBaselineSql([CREATE_TABLE, CREATE_INDEX])).toBe(
      `${CREATE_TABLE}\n--> statement-breakpoint\n${CREATE_INDEX}`,
    );
  });

  it("writes a single statement with no breakpoint", () => {
    expect(buildBaselineSql([CREATE_INDEX])).toBe(CREATE_INDEX);
  });
});
