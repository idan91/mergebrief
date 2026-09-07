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
import { join } from "node:path";
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

function cruiseEdge(source: string, target: string, typeOnly = false) {
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
    writeMember(root, source, { [target]: "workspace:*" });
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
    if (run.error) throw run.error;
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
      const run = cruiseEdge(source, "github", true);
      expect(run.status).toBe(1);
      expect(run.stdout).toContain("foundation-packages-import-only-types");
      expect(run.stdout).not.toContain(`declared-edges:${source}`);
    },
  );

  it.each(["logging", "i18n", "generators"])(
    "allows %s to import the types subpath",
    (source) => {
      const run = cruiseEdge(source, "types", true);
      expect(run.status).toBe(0);
      expect(run.stdout).toContain("no dependency violations found");
      expect(run.stdout).toContain("1 dependencies cruised");
    },
  );
});
