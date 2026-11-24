import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import {
  checkEnvExample,
  extractEnvKeys,
  findEnvExampleGaps,
} from "../src/env-example";
import { writeTree } from "./helpers";

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

describe("extractEnvKeys", () => {
  it("reads an index read of an env map", () => {
    const source = 'const level = env["LOG_LEVEL"] ?? process.env["NODE_ENV"];';

    expect(extractEnvKeys(source)).toEqual(["LOG_LEVEL", "NODE_ENV"]);
  });

  it("reads a key passed beside the env map", () => {
    const source = 'const url = readVar(env, "OTEL_EXPORTER_OTLP_ENDPOINT");';

    expect(extractEnvKeys(source)).toEqual(["OTEL_EXPORTER_OTLP_ENDPOINT"]);
  });

  it("reads schema keys and skips map keys holding a string", () => {
    const source = [
      "const EnvSchema = z.object({",
      "  DATABASE_URL: databaseUrlSchema,",
      "  MERGEBRIEF_API_PORT: PortSchema.optional(),",
      "});",
      "const Providers = {",
      '  CLAUDE_CODE: "claude-code",',
      "} as const;",
    ].join("\n");

    expect(extractEnvKeys(source)).toEqual([
      "DATABASE_URL",
      "MERGEBRIEF_API_PORT",
    ]);
  });

  it("reads a name constant and a name chosen by a ternary", () => {
    const source = [
      'const API_ORIGIN_ENV_VAR = "MERGEBRIEF_API_ORIGIN";',
      'const DEFAULT_SESSION_KEY_REF = "SESSION_KEY_V1";',
      "const name = traces === undefined",
      '  ? "OTEL_EXPORTER_OTLP_PROTOCOL"',
      '  : "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL";',
    ].join("\n");

    expect(extractEnvKeys(source)).toEqual([
      "MERGEBRIEF_API_ORIGIN",
      "OTEL_EXPORTER_OTLP_PROTOCOL",
      "OTEL_EXPORTER_OTLP_TRACES_PROTOCOL",
      "SESSION_KEY_V1",
    ]);
  });

  it("skips other constants and message text", () => {
    const source = [
      "const DEFAULT_POOL_MAX = 10;",
      'const WARNING = "MAX_ROWS";',
      'z.string({ error: "GITHUB_APP_ID is required" })',
    ].join("\n");

    expect(extractEnvKeys(source)).toEqual([]);
  });
});

describe("findEnvExampleGaps", () => {
  const parsers = [
    {
      path: "apps/api/src/config.ts",
      text: 'env["LOG_LEVEL"]; env["NODE_ENV"]',
    },
    { path: "apps/worker/src/config.ts", text: 'env["WORKER_COUNT"]' },
  ];

  it("names a key no line of the example mentions", () => {
    const gaps = findEnvExampleGaps({
      parsers,
      example: "# LOG_LEVEL=info\n",
      exemptions: new Map([["NODE_ENV", "set by the image"]]),
    });

    expect(gaps).toEqual({
      missing: [{ key: "WORKER_COUNT", paths: ["apps/worker/src/config.ts"] }],
      staleExemptions: [],
    });
  });

  it("names an exemption no parser reads any more", () => {
    const gaps = findEnvExampleGaps({
      parsers,
      example: "# LOG_LEVEL=info\n# WORKER_COUNT=1\n",
      exemptions: new Map([
        ["NODE_ENV", "set by the image"],
        ["GONE_KEY", "removed"],
      ]),
    });

    expect(gaps).toEqual({ missing: [], staleExemptions: ["GONE_KEY"] });
  });

  it("does not count a longer key that contains the name", () => {
    const gaps = findEnvExampleGaps({
      parsers: [{ path: "a.ts", text: 'env["DATABASE_URL"]' }],
      example: "# DATABASE_URL_FILE=/run/secrets/url\n",
      exemptions: new Map(),
    });

    expect(gaps.missing.map((gap) => gap.key)).toEqual(["DATABASE_URL"]);
  });
});

describe("checkEnvExample", () => {
  let root = "";

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("holds the checked-in example complete", () => {
    expect(checkEnvExample(REPO_ROOT)).toEqual({
      ok: true,
      value: { missing: [], staleExemptions: [] },
    });
  });

  it("fails when a listed parser file is gone", () => {
    root = mkdtempSync(join(tmpdir(), "env-example-"));
    writeTree(root, { ".env.example": "# LOG_LEVEL=info\n" });

    expect(checkEnvExample(root)).toMatchObject({ ok: false });
  });
});
