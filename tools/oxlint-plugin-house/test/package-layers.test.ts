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
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CRUISE_TIMEOUT_MS = 15_000;
const CRUISER_BIN = fileURLToPath(
  new URL(
    "../../bin/dependency-cruise.mjs",
    import.meta.resolve("dependency-cruiser"),
  ),
);

function writeMember(
  root: string,
  name: string,
  dependencies: Record<string, string>,
) {
  const member = join(root, "packages", name);
  mkdirSync(join(member, "src"), { recursive: true });
  writeFileSync(
    join(member, "package.json"),
    JSON.stringify({
      name,
      type: "module",
      exports: { ".": "./src/index.ts", "./contract": "./src/contract.ts" },
      dependencies,
    }),
  );
  writeFileSync(join(member, "src/index.ts"), "export const value = 1;\n");
  writeFileSync(
    join(member, "src/contract.ts"),
    "export interface Contract { value: string }\n",
  );
  symlinkSync(member, join(root, "node_modules", name), "dir");
}

interface EdgeOptions {
  readonly typeOnly?: boolean;
  /** False writes the import without the manifest dependency that permits it. */
  readonly declared?: boolean;
}

function cruiseEdge(source: string, target: string, options: EdgeOptions = {}) {
  const { typeOnly = false, declared = true } = options;
  const root = mkdtempSync(join(tmpdir(), "package-layers-"));
  try {
    for (const directory of ["apps", "packages", "tools", "node_modules"]) {
      mkdirSync(join(root, directory));
    }
    for (const config of [
      ".dependency-cruiser.cjs",
      ".dependency-cruiser.alias.cjs",
    ]) {
      copyFileSync(join(REPO_ROOT, config), join(root, config));
    }
    writeMember(root, source, declared ? { [target]: "workspace:*" } : {});
    writeMember(root, target, {});
    const file = join(root, "packages", source, "src/index.ts");
    const content = typeOnly
      ? `export type { Contract } from "${target}/contract";\n`
      : `export { value } from "${target}";\n`;
    writeFileSync(file, content);
    const run = spawnSync(
      process.execPath,
      [CRUISER_BIN, "--config", ".dependency-cruiser.cjs", "packages"],
      {
        cwd: root,
        encoding: "utf8",
        timeout: CRUISE_TIMEOUT_MS,
      },
    );
    if (run.error) {
      throw run.error;
    }
    return run;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** A cruise over a hand-written tree of relative imports, no manifests needed. */
function cruiseFiles(files: Readonly<Record<string, string>>) {
  const root = mkdtempSync(join(tmpdir(), "boundary-"));
  try {
    for (const directory of ["apps", "packages", "tools", "node_modules"]) {
      mkdirSync(join(root, directory));
    }
    for (const config of [
      ".dependency-cruiser.cjs",
      ".dependency-cruiser.alias.cjs",
    ]) {
      copyFileSync(join(REPO_ROOT, config), join(root, config));
    }
    const targets = new Set<string>();
    for (const [path, content] of Object.entries(files)) {
      const file = join(root, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
      targets.add(path.split("/")[0] ?? path);
    }
    const run = spawnSync(
      process.execPath,
      [CRUISER_BIN, "--config", ".dependency-cruiser.cjs", ...targets],
      { cwd: root, encoding: "utf8", timeout: CRUISE_TIMEOUT_MS },
    );
    if (run.error) {
      throw run.error;
    }
    return run;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("fixed package layers", () => {
  it("rejects a declared dependency from types to logging", () => {
    const run = cruiseEdge("types", "logging");
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("types-has-no-workspace-dependencies");
    expect(run.stdout).not.toContain("declared-edges:types");
  });

  it.each(["logging", "i18n", "generators"])(
    "rejects %s importing a declared peer",
    (source) => {
      const run = cruiseEdge(source, "github", { typeOnly: true });
      expect(run.status).toBe(1);
      expect(run.stdout).toContain("foundation-packages-import-only-types");
      expect(run.stdout).not.toContain(`declared-edges:${source}`);
    },
  );

  it.each(["logging", "i18n", "generators"])(
    "allows %s to import the types subpath",
    (source) => {
      const run = cruiseEdge(source, "types", { typeOnly: true });
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("no dependency violations found");
      expect(run.stdout).toContain("1 dependencies cruised");
    },
  );
});

describe("declared edges", () => {
  it("rejects an import the importer's manifest does not declare", () => {
    const run = cruiseEdge("brief-core", "github", { declared: false });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("declared-edges:brief-core");
  });

  it("allows the same import once the manifest declares it", () => {
    const run = cruiseEdge("brief-core", "github");
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("no dependency violations found");
    expect(run.stdout).toContain("1 dependencies cruised");
  });
});

describe("workspace kinds", () => {
  it("rejects one app importing another", () => {
    const run = cruiseFiles({
      "apps/web/src/a.ts": 'export { value } from "../../worker/src/b";\n',
      "apps/worker/src/b.ts": "export const value = 1;\n",
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("no-app-imports-another-app");
  });

  it("rejects a package importing an app", () => {
    const run = cruiseFiles({
      "packages/brief-core/src/a.ts":
        'export { value } from "../../../apps/api/src/b";\n',
      "apps/api/src/b.ts": "export const value = 1;\n",
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("no-package-imports-an-app");
  });

  it("rejects app and package source importing a tool", () => {
    const run = cruiseFiles({
      "apps/api/src/a.ts":
        'export { value } from "../../../tools/release/src/b";\n',
      "packages/brief-core/src/c.ts":
        'export { value } from "../../../tools/release/src/b";\n',
      "tools/release/src/b.ts": "export const value = 1;\n",
    });
    expect(run.status).toBe(2);
    expect(run.stdout).toContain("no-source-imports-a-tool");
    expect(run.stdout).toContain("apps/api/src/a.ts");
    expect(run.stdout).toContain("packages/brief-core/src/c.ts");
  });

  it("allows a tool to import package source", () => {
    const run = cruiseFiles({
      "tools/release/src/a.ts":
        'export { value } from "../../../packages/types/src/b";\n',
      "packages/types/src/b.ts": "export const value = 1;\n",
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("no dependency violations found");
  });
});

describe("apps/web feature boundaries", () => {
  it("rejects reaching past another feature's public shapes", () => {
    const run = cruiseFiles({
      "apps/web/src/features/inbox/a.ts":
        'export { value } from "../brief/utils/deep/inner";\n',
      "apps/web/src/features/brief/utils/deep/inner.ts":
        "export const value = 1;\n",
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("web-feature-imports-through-index");
  });

  it("allows one segment below another feature's root", () => {
    const run = cruiseFiles({
      "apps/web/src/features/inbox/a.ts":
        'export { value } from "../brief/utils";\n',
      "apps/web/src/features/brief/utils.ts": "export const value = 1;\n",
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("no dependency violations found");
    expect(run.stdout).toContain("1 dependencies cruised");
  });

  it("rejects a global folder importing a feature", () => {
    const run = cruiseFiles({
      "apps/web/src/components/a.ts":
        'export { value } from "../features/brief";\n',
      "apps/web/src/features/brief/index.ts": "export const value = 1;\n",
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("web-global-never-imports-features");
  });
});

describe("apps/web Brief layers", () => {
  it("rejects the Brief model importing another feature", () => {
    const run = cruiseFiles({
      "apps/web/src/features/brief/model/a.ts":
        'export type { Value } from "../../review/session";\n',
      "apps/web/src/features/review/session/index.ts":
        "export type Value = number;\n",
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("web-brief-model-imports-no-feature");
  });

  it("rejects the Brief model importing the Brief screen", () => {
    const run = cruiseFiles({
      "apps/web/src/features/brief/model/a.ts":
        'export { value } from "../screen/utils";\n',
      "apps/web/src/features/brief/screen/utils.ts":
        "export const value = 1;\n",
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("web-brief-model-imports-no-feature");
  });

  it("allows the Brief model to import the Brief queries", () => {
    const run = cruiseFiles({
      "apps/web/src/features/brief/model/a.ts":
        'export { value } from "../queries";\n',
      "apps/web/src/features/brief/queries.ts": "export const value = 1;\n",
    });
    expect(run.status).toBe(0);
  });

  it("rejects review importing the Brief screen", () => {
    const run = cruiseFiles({
      "apps/web/src/features/review/a.ts":
        'export { value } from "../brief/screen";\n',
      "apps/web/src/features/brief/screen/index.ts":
        "export const value = 1;\n",
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("web-review-imports-brief-model-only");
  });

  it("allows review to import the Brief model index", () => {
    const run = cruiseFiles({
      "apps/web/src/features/review/a.ts":
        'export { value } from "../brief/model";\n',
      "apps/web/src/features/brief/model/index.ts": "export const value = 1;\n",
    });
    expect(run.status).toBe(0);
  });

  it("rejects pulls importing the Brief screen past its entry", () => {
    const run = cruiseFiles({
      "apps/web/src/features/pulls/a.ts":
        'export { value } from "../brief/screen";\n',
      "apps/web/src/features/brief/screen/index.ts":
        "export const value = 1;\n",
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("web-pulls-imports-brief-entries-only");
  });

  it("allows pulls to import the Brief entry", () => {
    const run = cruiseFiles({
      "apps/web/src/features/pulls/a.ts": 'export { value } from "../brief";\n',
      "apps/web/src/features/brief/index.tsx": "export const value = 1;\n",
    });
    expect(run.status).toBe(0);
  });

  it("rejects the Brief screen importing pulls", () => {
    const run = cruiseFiles({
      "apps/web/src/features/brief/screen/a.ts":
        'export { value } from "../../pulls";\n',
      "apps/web/src/features/pulls/index.ts": "export const value = 1;\n",
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("web-brief-never-imports-pulls");
  });

  it("rejects the Brief queries importing the Brief screen", () => {
    const run = cruiseFiles({
      "apps/web/src/features/brief/queries.ts":
        'export { value } from "./screen/utils";\n',
      "apps/web/src/features/brief/screen/utils.ts":
        "export const value = 1;\n",
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("web-brief-model-imports-no-feature");
  });

  it("allows review to import the Brief fixtures", () => {
    const run = cruiseFiles({
      "apps/web/src/features/review/a.ts":
        'export { value } from "../brief/fixtures";\n',
      "apps/web/src/features/brief/fixtures.ts": "export const value = 1;\n",
    });
    expect(run.status).toBe(0);
  });

  it("allows pulls to import the Brief model, queries and fixtures", () => {
    const run = cruiseFiles({
      "apps/web/src/features/pulls/a.ts": [
        'export { model } from "../brief/model";',
        'export { queries } from "../brief/queries";',
        'export { fixtures } from "../brief/fixtures";',
        "",
      ].join("\n"),
      "apps/web/src/features/brief/model/index.ts": "export const model = 1;\n",
      "apps/web/src/features/brief/queries.ts": "export const queries = 1;\n",
      "apps/web/src/features/brief/fixtures.ts": "export const fixtures = 1;\n",
    });
    expect(run.status).toBe(0);
  });

  it("rejects the Brief entry importing pulls", () => {
    const run = cruiseFiles({
      "apps/web/src/features/brief/index.tsx":
        'export { value } from "../pulls";\n',
      "apps/web/src/features/pulls/index.ts": "export const value = 1;\n",
    });
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("web-brief-never-imports-pulls");
  });
});
