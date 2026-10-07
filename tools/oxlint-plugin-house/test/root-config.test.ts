import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OXLINT_BIN = join(
  dirname(require.resolve("oxlint/package.json")),
  "bin/oxlint",
);
const PLUGIN_ENTRY = join(REPO_ROOT, "tools/oxlint-plugin-house/src/index.mjs");
const CONFIG_PLUGIN_PATH = '"./tools/oxlint-plugin-house/src/index.mjs"';
const LINT_TIMEOUT_MS = 30_000;

interface JsonLabel {
  readonly span: { readonly line: number };
}

interface JsonDiagnostic {
  readonly code: string;
  readonly severity: string;
  readonly filename: string;
  readonly labels: readonly JsonLabel[];
}

interface JsonReport {
  readonly diagnostics: readonly JsonDiagnostic[];
}

function isJsonReport(value: unknown): value is JsonReport {
  if (typeof value !== "object" || value === null) return false;
  return Array.isArray((value as { diagnostics?: unknown }).diagnostics);
}

interface LintRequest {
  /** Source files by repo-relative path, written into the fixture root. */
  readonly files: Readonly<Record<string, string>>;
  /** Baseline entries, written as the repo's own suppressions file. */
  readonly suppressions?: Readonly<Record<string, unknown>>;
}

interface LintResult {
  readonly status: number;
  /**
   * Reported rules by fixture path as `<rule>@<severity>`, sorted, duplicates
   * kept. Severity rides in the key because a rule demoted to `warn` still
   * reports: only the severity says whether production would block it.
   */
  readonly rules: ReadonlyMap<string, readonly string[]>;
  /** Every path the tree carried, so an absent file is never read as clean. */
  readonly written: ReadonlySet<string>;
}

/**
 * The real root config with only two path adaptations: the house plugin is
 * resolved absolutely, and `node_modules` is symlinked so the pinned tool
 * binaries and `eslint-plugin-i18next` resolve from the fixture root. Rules,
 * overrides and ignore patterns are the production text.
 */
function writeAdaptedRootConfig(root: string): void {
  const source = readFileSync(join(REPO_ROOT, ".oxlintrc.json"), "utf8");
  if (!source.includes(CONFIG_PLUGIN_PATH)) {
    throw new Error("the root config no longer names the house plugin by path");
  }
  const adapted = source.replace(CONFIG_PLUGIN_PATH, () =>
    JSON.stringify(PLUGIN_ENTRY),
  );
  writeFileSync(join(root, ".oxlintrc.json"), adapted);
  symlinkSync(
    join(REPO_ROOT, "node_modules"),
    join(root, "node_modules"),
    "dir",
  );
}

function ruleIdOf(code: string): string | undefined {
  const house = /^house\((.+)\)$/.exec(code);
  if (house?.[1] !== undefined) return `house/${house[1]}`;
  const plugin = /^eslint-plugin-i18next\((.+)\)$/.exec(code);
  if (plugin?.[1] !== undefined) return `i18next/${plugin[1]}`;
  // Core rules the root config configures itself, so a rule option the
  // config text promises is provable against a real run.
  const core = /^eslint\((.+)\)$/.exec(code);
  if (core?.[1] !== undefined) return `eslint/${core[1]}`;
  const imports = /^import\((.+)\)$/.exec(code);
  if (imports?.[1] !== undefined) return `import/${imports[1]}`;
  return undefined;
}

/** One oxlint run over a throwaway tree, under the production configuration. */
function lintTree(request: LintRequest): LintResult {
  const root = mkdtempSync(join(tmpdir(), "root-config-"));
  try {
    writeAdaptedRootConfig(root);
    if (request.suppressions !== undefined) {
      writeFileSync(
        join(root, "oxlint-suppressions.json"),
        JSON.stringify(request.suppressions),
      );
    }
    const targets = new Set<string>();
    for (const [path, content] of Object.entries(request.files)) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
      targets.add(path.split("/")[0] ?? path);
    }
    const realRoot = realpathSync(root);
    const run = spawnSync(
      OXLINT_BIN,
      [
        "-c",
        ".oxlintrc.json",
        "--format",
        "json",
        "--disable-nested-config",
        ...targets,
      ],
      { cwd: root, encoding: "utf8", timeout: LINT_TIMEOUT_MS },
    );
    if (run.error) throw run.error;

    const parsed: unknown = JSON.parse(run.stdout);
    if (!isJsonReport(parsed)) {
      throw new Error(`oxlint printed no JSON report: ${run.stderr}`);
    }
    const rules = new Map<string, string[]>();
    for (const diagnostic of parsed.diagnostics) {
      const rule = ruleIdOf(diagnostic.code);
      if (rule === undefined) continue;
      const reported = `${rule}@${diagnostic.severity}`;
      const key = isAbsolute(diagnostic.filename)
        ? relative(realRoot, diagnostic.filename)
        : diagnostic.filename;
      const found = rules.get(key) ?? [];
      found.push(reported);
      rules.set(key, found);
    }
    for (const [key, found] of rules) rules.set(key, found.toSorted());
    return {
      status: run.status ?? -1,
      rules,
      written: new Set(Object.keys(request.files)),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * The rules reported for one fixture. Throws for a path the tree never held:
 * an empty result must mean "linted and clean", never "never visited".
 */
function rulesFor(result: LintResult, path: string): readonly string[] {
  if (!result.written.has(path)) {
    throw new Error(`${path} was not written into the fixture tree`);
  }
  return result.rules.get(path) ?? [];
}

const HAND_BUILT_PLURAL = `export function label(count: number): string {
  return \`\${count} file\${count === 1 ? "" : "s"}\`;
}
`;
const READS_ENVIRONMENT = `export const url = process.env.DATABASE_URL;\n`;
const RAW_BUTTON = `export function Widget() {\n  return <button type="button" />;\n}\n`;
const OVER_LONG_TITLE = "a".repeat(80);
/** Eight content lines: the cap itself, which must pass. */
const CAP_COMMENT = Array.from(
  { length: 8 },
  (_unused, index) => `// invariant line ${index + 1}`,
).join("\n");

/** Nine: one past the cap, which must report. */
const OVER_CAP_COMMENT = `${CAP_COMMENT}\n// invariant line 9`;

/** The absence check the standard bans: one operator matching both forms. */
const LOOSE_ABSENCE = `export function isAbsent(value: number | null | undefined): boolean {
  return value == null;
}
`;

/** The same intent spelled so null and undefined stay distinguishable. */
const EXPLICIT_ABSENCE = `export function isAbsent(value: number | null | undefined): boolean {
  return value === null || value === undefined;
}
`;

const DEFAULT_EXPORTED_FACTORY = `export default function createHandlers() {\n  return {};\n}\n`;
const NAMED_CONTROLLER = `export const widgetsController = { listWidgets };\n\nfunction listWidgets() {\n  return [];\n}\n`;
const ZOD_ROOT_IMPORT = `import { z } from "zod";\n\nexport const name = z.string();\n`;
const ZOD_V4_IMPORT = `import { z } from "zod/v4";\n\nexport const name = z.string();\n`;

function emDashComment(name: string): string {
  return `// A comment carrying an em dash — right here.\nexport const ${name} = 1;\n`;
}

/**
 * One tree carrying every path-scoped case. Each negative shares the run with
 * a positive, so an empty result cannot mean the run never happened.
 */
const MATRIX_FILES = {
  "apps/web/src/features/brief/utils/label.ts": HAND_BUILT_PLURAL,
  "apps/web/src/features/brief/Label.tsx": HAND_BUILT_PLURAL,
  "packages/brief-core/src/label.ts": HAND_BUILT_PLURAL,
  "apps/worker/src/main.ts": READS_ENVIRONMENT,
  "apps/worker/src/task/spend.ts": READS_ENVIRONMENT,
  "packages/brief-core/test/long.test.ts": `import { it } from "vitest";\n\nit("${OVER_LONG_TITLE}", () => {});\n`,
  "packages/brief-core/src/dash.ts": emDashComment("value"),
  "packages/brief-core/src/long.ts": `${CAP_COMMENT}\nexport const a = 1;\n`,
  "packages/brief-core/src/wall.ts": `${OVER_CAP_COMMENT}\nexport const b = 1;\n`,
  "apps/web/src/features/brief/Widget.tsx": RAW_BUTTON,
  "apps/web/src/components/Button/Button.tsx": RAW_BUTTON,
  "packages/brief-core/src/loose-absence.ts": LOOSE_ABSENCE,
  "packages/brief-core/src/explicit-absence.ts": EXPLICIT_ABSENCE,
  "packages/types/src/helper.ts":
    "export function helper() {\n  return 1;\n}\n",
  "packages/types/src/maps.ts":
    'export const Kinds = { LINE: "line", FILE: "file" } as const;\n',
  "apps/api/src/routes/widgets/handler.ts": DEFAULT_EXPORTED_FACTORY,
  "apps/api/src/routes/widgets/controller.ts": NAMED_CONTROLLER,
  "packages/brief-core/src/zod-root.ts": ZOD_ROOT_IMPORT,
  "packages/brief-core/src/zod-v4.ts": ZOD_V4_IMPORT,
};

let matrix: LintResult | undefined;

function lintMatrix(): LintResult {
  matrix ??= lintTree({ files: MATRIX_FILES });
  return matrix;
}

describe("the matrix run itself", () => {
  it("fails the process, so these rules block a real lint run", () => {
    expect(lintMatrix().status).toBe(1);
  });
});

describe("plural rule coverage", () => {
  it("reports a hand-built plural in a web helper and a web component", () => {
    expect(
      rulesFor(lintMatrix(), "apps/web/src/features/brief/utils/label.ts"),
    ).toContain("house/no-hand-built-plural@error");
    expect(
      rulesFor(lintMatrix(), "apps/web/src/features/brief/Label.tsx"),
    ).toContain("house/no-hand-built-plural@error");
  });

  it("leaves the same shape alone outside apps/web", () => {
    expect(rulesFor(lintMatrix(), "packages/brief-core/src/label.ts")).toEqual(
      [],
    );
  });
});

describe("composition-root scope", () => {
  it("allows the worker entry to read the environment", () => {
    expect(rulesFor(lintMatrix(), "apps/worker/src/main.ts")).toEqual([]);
  });

  it("reports environment access outside a declared root", () => {
    expect(rulesFor(lintMatrix(), "apps/worker/src/task/spend.ts")).toEqual([
      "house/no-process-env@error",
    ]);
  });
});

describe("retained copy gates", () => {
  it("reports an over-long test title and an em-dash comment", () => {
    expect(
      rulesFor(lintMatrix(), "packages/brief-core/test/long.test.ts"),
    ).toEqual(["house/test-title@error"]);
    expect(rulesFor(lintMatrix(), "packages/brief-core/src/dash.ts")).toEqual([
      "house/no-em-dash@error",
    ]);
  });

  it("passes a comment run at the cap and reports one past it", () => {
    expect(rulesFor(lintMatrix(), "packages/brief-core/src/long.ts")).toEqual(
      [],
    );
    expect(rulesFor(lintMatrix(), "packages/brief-core/src/wall.ts")).toEqual([
      "house/comment-run@error",
    ]);
  });
});

describe("shared-button allowlist", () => {
  it("reports a raw button in a feature but not in the shared one", () => {
    expect(
      rulesFor(lintMatrix(), "apps/web/src/features/brief/Widget.tsx"),
    ).toContain("house/no-raw-button@error");
    expect(
      rulesFor(lintMatrix(), "apps/web/src/components/Button/Button.tsx"),
    ).not.toContainEqual(expect.stringMatching(/^house\/no-raw-button@/));
  });
});

describe("types package runtime", () => {
  it("reports a function in packages/types", () => {
    expect(rulesFor(lintMatrix(), "packages/types/src/helper.ts")).toContain(
      "house/types-const-maps@error",
    );
  });

  it("passes an as const map in packages/types", () => {
    expect(rulesFor(lintMatrix(), "packages/types/src/maps.ts")).toEqual([]);
  });
});

describe("absence checks", () => {
  it("reports a loose null comparison", () => {
    expect(
      rulesFor(lintMatrix(), "packages/brief-core/src/loose-absence.ts"),
    ).toContain("eslint/eqeqeq@error");
  });

  it("passes explicit null and undefined checks", () => {
    expect(
      rulesFor(lintMatrix(), "packages/brief-core/src/explicit-absence.ts"),
    ).not.toContainEqual(expect.stringMatching(/^eslint\/eqeqeq@/));
  });
});

describe("api domain exports", () => {
  it("reports a default-exported handler factory", () => {
    expect(
      rulesFor(lintMatrix(), "apps/api/src/routes/widgets/handler.ts"),
    ).toContain("import/no-default-export@error");
  });

  it("passes a named controller", () => {
    expect(
      rulesFor(lintMatrix(), "apps/api/src/routes/widgets/controller.ts"),
    ).toEqual([]);
  });
});

describe("zod import path", () => {
  it("reports the bare zod package", () => {
    expect(
      rulesFor(lintMatrix(), "packages/brief-core/src/zod-root.ts"),
    ).toContain("eslint/no-restricted-imports@error");
  });

  it("passes the zod/v4 subpath", () => {
    expect(rulesFor(lintMatrix(), "packages/brief-core/src/zod-v4.ts")).toEqual(
      [],
    );
  });
});

describe("suppression baseline", () => {
  const path = "packages/brief-core/src/dash.ts";
  const one = { [path]: emDashComment("value") };
  const two = { [path]: `${emDashComment("first")}${emDashComment("second")}` };

  it("fails an unsuppressed violation", () => {
    expect(lintTree({ files: one }).status).toBe(1);
  });

  it("passes the same violation once the baseline carries it", () => {
    const result = lintTree({
      files: one,
      suppressions: { [path]: { "house/no-em-dash": { count: 1 } } },
    });
    expect(result.status).toBe(0);
  });

  it("still fails when the baseline undercounts the violations", () => {
    const unsuppressed = lintTree({ files: two });
    expect(rulesFor(unsuppressed, path)).toEqual([
      "house/no-em-dash@error",
      "house/no-em-dash@error",
    ]);
    const result = lintTree({
      files: two,
      suppressions: { [path]: { "house/no-em-dash": { count: 1 } } },
    });
    expect(result.status).toBe(1);
  });
});
