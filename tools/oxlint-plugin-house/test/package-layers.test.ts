import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CRUISE_TIMEOUT_MS = 15_000;
const CRUISER_BIN = fileURLToPath(
  new URL(
    "../../bin/dependency-cruise.mjs",
    import.meta.resolve("dependency-cruiser"),
  ),
);

const VALUE = "export const value = 1;\n";
const TYPE_FROM_GITHUB = 'export type { Contract } from "github/contract";\n';
const TYPE_FROM_TYPES = 'export type { Contract } from "types/contract";\n';

/** Workspace packages with a manifest, keyed by name, valued by declared deps. */
const MEMBERS: Readonly<Record<string, readonly string[]>> = {
  types: ["logging"],
  logging: ["github", "types"],
  i18n: ["github", "types"],
  generators: ["github", "types"],
  github: [],
  "brief-core": ["github"],
  persistence: [],
};

/** Every source file in the one tree; each importer holds only its own case. */
const FILES: Readonly<Record<string, string>> = {
  "packages/types/src/index.ts": 'export { value } from "logging";\n',
  "packages/logging/src/peer.ts": TYPE_FROM_GITHUB,
  "packages/logging/src/types-subpath.ts": TYPE_FROM_TYPES,
  "packages/i18n/src/peer.ts": TYPE_FROM_GITHUB,
  "packages/i18n/src/types-subpath.ts": TYPE_FROM_TYPES,
  "packages/generators/src/peer.ts": TYPE_FROM_GITHUB,
  "packages/generators/src/types-subpath.ts": TYPE_FROM_TYPES,
  "packages/brief-core/src/undeclared.ts":
    'export { value } from "persistence";\n',
  "packages/brief-core/src/declared.ts": 'export { value } from "github";\n',

  "apps/web/src/imports-worker.ts":
    'export { value } from "../../worker/src/value";\n',
  "apps/worker/src/value.ts": VALUE,
  "packages/brief-core/src/imports-app.ts":
    'export { value } from "../../../apps/api/src/value";\n',
  "apps/api/src/value.ts": VALUE,
  "apps/api/src/imports-tool.ts":
    'export { value } from "../../../tools/release/src/value";\n',
  "packages/brief-core/src/imports-tool.ts":
    'export { value } from "../../../tools/release/src/value";\n',
  "tools/release/src/value.ts": VALUE,
  "tools/release/src/imports-package.ts":
    'export { value } from "../../../packages/types/src/value";\n',
  "packages/types/src/value.ts": VALUE,

  "apps/web/src/features/inbox/imports-deep.ts":
    'export { value } from "../brief/utils/deep/inner";\n',
  "apps/web/src/features/brief/utils/deep/inner.ts": VALUE,
  "apps/web/src/features/inbox/imports-segment.ts":
    'export { value } from "../brief/utils";\n',
  "apps/web/src/features/brief/utils.ts": VALUE,
  "apps/web/src/components/imports-feature.ts":
    'export { value } from "../features/brief";\n',

  "apps/web/src/features/brief/index.tsx":
    'export { value } from "../pulls";\n',
  "apps/web/src/features/pulls/index.ts": VALUE,
  "apps/web/src/features/brief/model/imports-review.ts":
    'export type { Value } from "../../review/session";\n',
  "apps/web/src/features/review/session/index.ts":
    "export type Value = number;\n",
  "apps/web/src/features/brief/model/imports-ui.ts":
    'export { value } from "../ui/utils";\n',
  "apps/web/src/features/brief/ui/utils.ts": VALUE,
  "apps/web/src/features/brief/model/imports-queries.ts":
    'export { value } from "../queries";\n',
  "apps/web/src/features/brief/queries.ts":
    'export { value } from "./ui/utils";\n',
  "apps/web/src/features/review/imports-ui.ts":
    'export { value } from "../brief/ui";\n',
  "apps/web/src/features/brief/ui/index.ts": VALUE,
  "apps/web/src/features/review/imports-model.ts":
    'export { value } from "../brief/model";\n',
  "apps/web/src/features/brief/model/index.ts": VALUE,
  "apps/web/src/features/pulls/imports-ui.ts":
    'export { value } from "../brief/ui";\n',
  "apps/web/src/features/pulls/imports-entry.ts":
    'export { value } from "../brief";\n',
  "apps/web/src/features/brief/ui/imports-pulls.ts":
    'export { value } from "../../pulls";\n',
  "apps/web/src/features/review/imports-test-utils.test.ts":
    'export { value } from "../brief/test-utils";\n',
  "apps/web/src/features/brief/test-utils/index.ts":
    'export { value } from "./fixtures";\n',
  "apps/web/src/features/brief/test-utils/fixtures.ts":
    'export { value } from "../ui/utils";\n',
  "apps/web/src/features/pulls/imports-brief.test.ts": [
    'export { value as model } from "../brief/model";',
    'export { value as queries } from "../brief/queries";',
    'export { value as fixtures } from "../brief/test-utils";',
    "",
  ].join("\n"),

  "apps/web/src/features/brief/ui/imports-render.ts":
    'export { value } from "../test-utils/render";\n',
  "apps/web/src/features/brief/test-utils/render.tsx": VALUE,
  "apps/web/src/features/review/imports-test-utils.ts":
    'export { value } from "../brief/test-utils";\n',
  "apps/web/src/features/brief/model/imports-test-utils.test.ts":
    'export { value } from "../test-utils";\n',
  "apps/web/src/features/brief/model/imports-fixtures.test.ts":
    'export { value } from "../test-utils/fixtures";\n',
  "apps/web/src/characterization/imports-test-utils.test.tsx":
    'export { value } from "../features/brief/test-utils";\n',
};

interface CruiseRule {
  readonly name: string;
  readonly severity: string;
}

interface CruiseDependency {
  readonly resolved: string;
  readonly rules?: readonly CruiseRule[];
}

interface CruiseModule {
  readonly source: string;
  readonly dependencies: readonly CruiseDependency[];
}

interface CruiseReport {
  readonly modules: readonly CruiseModule[];
  readonly summary: {
    readonly error: number;
    readonly violations: readonly unknown[];
  };
}

interface CruiseResult {
  readonly status: number | null;
  readonly report: CruiseReport;
}

/** Each resolved target the module imports, mapped to its `rule@severity` list. */
type EdgeRules = Record<string, readonly string[]>;

function writeMember(root: string, name: string, dependencies: string[]) {
  const member = join(root, "packages", name);
  mkdirSync(join(member, "src"), { recursive: true });
  const declared = Object.fromEntries(
    dependencies.map((dependency) => [dependency, "workspace:*"]),
  );
  writeFileSync(
    join(member, "package.json"),
    JSON.stringify({
      name,
      type: "module",
      exports: { ".": "./src/index.ts", "./contract": "./src/contract.ts" },
      dependencies: declared,
    }),
  );
  writeFileSync(join(member, "src/index.ts"), VALUE);
  writeFileSync(
    join(member, "src/contract.ts"),
    "export interface Contract { value: string }\n",
  );
  symlinkSync(member, join(root, "node_modules", name), "dir");
}

function writeTree(root: string) {
  for (const directory of ["apps", "packages", "tools", "node_modules"]) {
    mkdirSync(join(root, directory));
  }
  for (const config of [
    ".dependency-cruiser.cjs",
    ".dependency-cruiser.alias.cjs",
  ]) {
    copyFileSync(join(REPO_ROOT, config), join(root, config));
  }
  for (const [name, dependencies] of Object.entries(MEMBERS)) {
    writeMember(root, name, [...dependencies]);
  }
  for (const [path, content] of Object.entries(FILES)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

function runCruiser(root: string, reporter: readonly string[]) {
  const run = spawnSync(
    process.execPath,
    [
      CRUISER_BIN,
      "--config",
      ".dependency-cruiser.cjs",
      ...reporter,
      "apps",
      "packages",
      "tools",
    ],
    { cwd: root, encoding: "utf8", timeout: CRUISE_TIMEOUT_MS },
  );
  if (run.error) {
    throw run.error;
  }
  return run;
}

/**
 * The JSON report carries every edge's rules but always exits 0, so the
 * default reporter `pnpm lint` runs cruises the same tree for the exit code.
 */
function cruiseTree(): CruiseResult {
  const root = mkdtempSync(join(tmpdir(), "package-layers-"));
  try {
    writeTree(root);
    const json = runCruiser(root, ["--output-type", "json"]);
    const gate = runCruiser(root, []);
    const report = JSON.parse(json.stdout) as CruiseReport;
    return { status: gate.status, report };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

let cruise: CruiseResult;

beforeAll(() => {
  cruise = cruiseTree();
});

function readEdges(source: string): EdgeRules {
  const module = cruise.report.modules.find(
    (candidate) => candidate.source === source,
  );
  if (module === undefined) {
    throw new Error(`the cruise saw no module ${source}`);
  }
  const edges: EdgeRules = {};
  for (const dependency of module.dependencies) {
    const rules = dependency.rules ?? [];
    edges[dependency.resolved] = rules.map(
      (rule) => `${rule.name}@${rule.severity}`,
    );
  }
  return edges;
}

describe("the shared cruise", () => {
  it("exits the gate with one error per reported violation", () => {
    const { status, report } = cruise;
    expect(report.summary.violations.length).toBeGreaterThan(0);
    expect(report.summary.error).toBe(report.summary.violations.length);
    expect(status).toBe(report.summary.error);
  });
});

describe("fixed package layers", () => {
  it("rejects a declared dependency from types to logging", () => {
    expect(readEdges("packages/types/src/index.ts")).toEqual({
      "packages/logging/src/index.ts": [
        "types-has-no-workspace-dependencies@error",
      ],
    });
  });

  it.each(["logging", "i18n", "generators"])(
    "rejects %s importing a declared peer",
    (source) => {
      expect(readEdges(`packages/${source}/src/peer.ts`)).toEqual({
        "packages/github/src/contract.ts": [
          "foundation-packages-import-only-types@error",
        ],
      });
    },
  );

  it.each(["logging", "i18n", "generators"])(
    "allows %s to import the types subpath",
    (source) => {
      expect(readEdges(`packages/${source}/src/types-subpath.ts`)).toEqual({
        "packages/types/src/contract.ts": [],
      });
    },
  );
});

describe("declared edges", () => {
  it("rejects an import the importer's manifest does not declare", () => {
    expect(readEdges("packages/brief-core/src/undeclared.ts")).toEqual({
      "packages/persistence/src/index.ts": ["declared-edges:brief-core@error"],
    });
  });

  it("allows the same importer a package its manifest declares", () => {
    expect(readEdges("packages/brief-core/src/declared.ts")).toEqual({
      "packages/github/src/index.ts": [],
    });
  });
});

describe("workspace kinds", () => {
  it("rejects one app importing another", () => {
    expect(readEdges("apps/web/src/imports-worker.ts")).toEqual({
      "apps/worker/src/value.ts": ["no-app-imports-another-app@error"],
    });
  });

  it("rejects a package importing an app", () => {
    expect(readEdges("packages/brief-core/src/imports-app.ts")).toEqual({
      "apps/api/src/value.ts": ["no-package-imports-an-app@error"],
    });
  });

  it("rejects app and package source importing a tool", () => {
    const expected = {
      "tools/release/src/value.ts": ["no-source-imports-a-tool@error"],
    };
    expect(readEdges("apps/api/src/imports-tool.ts")).toEqual(expected);
    expect(readEdges("packages/brief-core/src/imports-tool.ts")).toEqual(
      expected,
    );
  });

  it("allows a tool to import package source", () => {
    expect(readEdges("tools/release/src/imports-package.ts")).toEqual({
      "packages/types/src/value.ts": [],
    });
  });
});

describe("apps/web feature boundaries", () => {
  it("rejects reaching past another feature's public shapes", () => {
    expect(readEdges("apps/web/src/features/inbox/imports-deep.ts")).toEqual({
      "apps/web/src/features/brief/utils/deep/inner.ts": [
        "web-feature-imports-through-index@error",
      ],
    });
  });

  it("allows one segment below another feature's root", () => {
    expect(readEdges("apps/web/src/features/inbox/imports-segment.ts")).toEqual(
      { "apps/web/src/features/brief/utils.ts": [] },
    );
  });

  it("rejects a global folder importing a feature", () => {
    expect(readEdges("apps/web/src/components/imports-feature.ts")).toEqual({
      "apps/web/src/features/brief/index.tsx": [
        "web-global-never-imports-features@error",
      ],
    });
  });
});

describe("apps/web Brief layers", () => {
  it("rejects the Brief model importing another feature", () => {
    expect(
      readEdges("apps/web/src/features/brief/model/imports-review.ts"),
    ).toEqual({
      "apps/web/src/features/review/session/index.ts": [
        "web-brief-model-imports-no-feature@error",
      ],
    });
  });

  it("rejects the Brief model importing the Brief ui", () => {
    expect(
      readEdges("apps/web/src/features/brief/model/imports-ui.ts"),
    ).toEqual({
      "apps/web/src/features/brief/ui/utils.ts": [
        "web-brief-model-imports-no-feature@error",
      ],
    });
  });

  it("allows the Brief model to import the Brief queries", () => {
    expect(
      readEdges("apps/web/src/features/brief/model/imports-queries.ts"),
    ).toEqual({ "apps/web/src/features/brief/queries.ts": [] });
  });

  it("rejects review importing the Brief ui", () => {
    expect(readEdges("apps/web/src/features/review/imports-ui.ts")).toEqual({
      "apps/web/src/features/brief/ui/index.ts": [
        "web-review-imports-brief-model-only@error",
      ],
    });
  });

  it("allows review to import the Brief model index", () => {
    expect(readEdges("apps/web/src/features/review/imports-model.ts")).toEqual({
      "apps/web/src/features/brief/model/index.ts": [],
    });
  });

  it("rejects pulls importing the Brief ui past its entry", () => {
    expect(readEdges("apps/web/src/features/pulls/imports-ui.ts")).toEqual({
      "apps/web/src/features/brief/ui/index.ts": [
        "web-pulls-imports-brief-entries-only@error",
      ],
    });
  });

  it("allows pulls to import the Brief entry", () => {
    expect(readEdges("apps/web/src/features/pulls/imports-entry.ts")).toEqual({
      "apps/web/src/features/brief/index.tsx": [],
    });
  });

  it("rejects the Brief ui importing pulls", () => {
    expect(
      readEdges("apps/web/src/features/brief/ui/imports-pulls.ts"),
    ).toEqual({
      "apps/web/src/features/pulls/index.ts": [
        "web-brief-never-imports-pulls@error",
      ],
    });
  });

  it("rejects the Brief queries importing the Brief ui", () => {
    expect(readEdges("apps/web/src/features/brief/queries.ts")).toEqual({
      "apps/web/src/features/brief/ui/utils.ts": [
        "web-brief-model-imports-no-feature@error",
      ],
    });
  });

  it("allows review tests to import the Brief test-utils index", () => {
    expect(
      readEdges("apps/web/src/features/review/imports-test-utils.test.ts"),
    ).toEqual({ "apps/web/src/features/brief/test-utils/index.ts": [] });
  });

  it("allows pulls tests to import the Brief model, queries and test-utils", () => {
    expect(
      readEdges("apps/web/src/features/pulls/imports-brief.test.ts"),
    ).toEqual({
      "apps/web/src/features/brief/model/index.ts": [],
      "apps/web/src/features/brief/queries.ts": [],
      "apps/web/src/features/brief/test-utils/index.ts": [],
    });
  });

  it("rejects the Brief entry importing pulls", () => {
    expect(readEdges("apps/web/src/features/brief/index.tsx")).toEqual({
      "apps/web/src/features/pulls/index.ts": [
        "web-brief-never-imports-pulls@error",
      ],
    });
  });
});

describe("apps/web test-utils modules", () => {
  it("rejects a production file importing test-utils", () => {
    expect(
      readEdges("apps/web/src/features/brief/ui/imports-render.ts"),
    ).toEqual({
      "apps/web/src/features/brief/test-utils/render.tsx": [
        "web-test-utils-only-in-tests@error",
      ],
    });
  });

  it("rejects another feature's source importing the Brief test-utils", () => {
    expect(
      readEdges("apps/web/src/features/review/imports-test-utils.ts"),
    ).toEqual({
      "apps/web/src/features/brief/test-utils/index.ts": [
        "web-test-utils-only-in-tests@error",
      ],
    });
  });

  it("rejects a model test importing the test-utils index", () => {
    expect(
      readEdges("apps/web/src/features/brief/model/imports-test-utils.test.ts"),
    ).toEqual({
      "apps/web/src/features/brief/test-utils/index.ts": [
        "web-brief-model-imports-no-feature@error",
      ],
    });
  });

  it("allows a model test to import the Brief fixtures", () => {
    expect(
      readEdges("apps/web/src/features/brief/model/imports-fixtures.test.ts"),
    ).toEqual({ "apps/web/src/features/brief/test-utils/fixtures.ts": [] });
  });

  it("rejects the Brief fixtures importing the Brief ui", () => {
    expect(
      readEdges("apps/web/src/features/brief/test-utils/fixtures.ts"),
    ).toEqual({
      "apps/web/src/features/brief/ui/utils.ts": [
        "web-brief-model-imports-no-feature@error",
      ],
    });
  });

  it("allows the test-utils index to import its members", () => {
    expect(
      readEdges("apps/web/src/features/brief/test-utils/index.ts"),
    ).toEqual({ "apps/web/src/features/brief/test-utils/fixtures.ts": [] });
  });

  it("allows a test outside the features to import a feature's test-utils", () => {
    expect(
      readEdges("apps/web/src/characterization/imports-test-utils.test.tsx"),
    ).toEqual({ "apps/web/src/features/brief/test-utils/index.ts": [] });
  });
});
