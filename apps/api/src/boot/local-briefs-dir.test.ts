import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeOutDir, removeOutDirs } from "../../test/local-briefs-fixtures";
import { resolveLocalBriefsDir } from "./local-briefs-dir";
import { findWorkspaceRoot } from "./workspace-root";

afterEach(removeOutDirs);

async function makeCheckout(): Promise<{ root: string; app: string }> {
  const root = await makeOutDir();
  const app = join(root, "apps", "api");
  await mkdir(app, { recursive: true });
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n");
  return { root, app };
}

describe("resolveLocalBriefsDir", () => {
  it("keeps an absolute dir as written", () => {
    expect(resolveLocalBriefsDir("/srv/out", "/anywhere")).toBe("/srv/out");
  });

  it("resolves a relative dir against the checkout root, not the cwd", async () => {
    const { root, app } = await makeCheckout();

    expect(resolveLocalBriefsDir("tools/categorizer/out", app)).toBe(
      join(root, "tools", "categorizer", "out"),
    );
  });

  it("falls back to the cwd where no checkout holds it", async () => {
    const bare = await makeOutDir();

    expect(findWorkspaceRoot(bare)).toBe(bare);
    expect(resolveLocalBriefsDir("out", bare)).toBe(join(bare, "out"));
  });
});
