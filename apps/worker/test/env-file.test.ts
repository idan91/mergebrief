import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnvFiles } from "../src/env-file";

const ROOT_ONLY = "ENV_FILE_TEST_ROOT_ONLY";
const IN_BOTH = "ENV_FILE_TEST_IN_BOTH";
const VARIABLES = [ROOT_ONLY, IN_BOTH];

const scratchDirs: string[] = [];

interface Workspace {
  readonly root: string;
  readonly appDir: string;
}

function makeWorkspace(marker: boolean): Workspace {
  const root = mkdtempSync(join(tmpdir(), "env-file-"));
  scratchDirs.push(root);
  const appDir = join(root, "apps", "worker");
  mkdirSync(appDir, { recursive: true });
  if (marker) {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  }
  return { root, appDir };
}

afterEach(() => {
  for (const name of VARIABLES) {
    delete process.env[name];
  }
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("loadEnvFiles", () => {
  it("fills a variable the app file leaves out from the workspace root", () => {
    const { root, appDir } = makeWorkspace(true);
    writeFileSync(join(root, ".env"), `${ROOT_ONLY}=root\n`);
    writeFileSync(join(appDir, ".env"), `${IN_BOTH}=app\n`);

    loadEnvFiles(appDir);

    expect(process.env[ROOT_ONLY]).toBe("root");
    expect(process.env[IN_BOTH]).toBe("app");
  });

  it("keeps the app file's value over the workspace root's", () => {
    const { root, appDir } = makeWorkspace(true);
    writeFileSync(join(root, ".env"), `${IN_BOTH}=root\n`);
    writeFileSync(join(appDir, ".env"), `${IN_BOTH}=app\n`);

    loadEnvFiles(appDir);

    expect(process.env[IN_BOTH]).toBe("app");
  });

  it("keeps a value the environment already holds", () => {
    const { root, appDir } = makeWorkspace(true);
    writeFileSync(join(root, ".env"), `${ROOT_ONLY}=root\n`);
    process.env[ROOT_ONLY] = "shell";

    loadEnvFiles(appDir);

    expect(process.env[ROOT_ONLY]).toBe("shell");
  });

  it("reads no file above a directory outside a workspace", () => {
    const { root, appDir } = makeWorkspace(false);
    writeFileSync(join(root, ".env"), `${ROOT_ONLY}=root\n`);

    loadEnvFiles(appDir);

    expect(process.env[ROOT_ONLY]).toBeUndefined();
  });

  it("loads nothing and does not throw when no file exists", () => {
    const { appDir } = makeWorkspace(true);

    expect(() => {
      loadEnvFiles(appDir);
    }).not.toThrow();
    expect(process.env[ROOT_ONLY]).toBeUndefined();
  });
});
