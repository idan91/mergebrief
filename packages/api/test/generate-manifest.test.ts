// The manifest generator's two modes: the write path may short-circuit when
// the committed file is newer than every source, the `--check` gate never may.
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { renderManifest } from "../src/product-operations/manifest";
import { productOperationRegistry } from "../src/product-operations/registry";
import type { ProductOperationDescriptor } from "../src/product-operations/types";
import {
  MANIFEST_FAILURE,
  MANIFEST_MODE,
  MANIFEST_OUTCOME,
  runManifest,
} from "../scripts/run-manifest";
import { composeCatalog } from "./compose-catalog";

const run = promisify(execFile);

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REAL_MANIFEST = join(PACKAGE_ROOT, "product-operations.manifest.json");
const REAL_ROUTE_SOURCE = join(PACKAGE_ROOT, "src", "routes", "pulls.ts");
const GENERATOR = join(PACKAGE_ROOT, "scripts", "generate-manifest.ts");
const TSX = join(PACKAGE_ROOT, "node_modules", ".bin", "tsx");

const SAMPLE: ProductOperationDescriptor = {
  id: "probe-op",
  kind: "query",
  classification: "read",
  agentAvailable: true,
  endpoint: "GET /api/probe",
};

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "generate-manifest-"));
  tempRoots.push(root);
  return root;
}

async function setMtime(path: string, epochSeconds: number): Promise<void> {
  const when = new Date(epochSeconds * 1_000);
  await utimes(path, when, when);
}

async function collectFromComposedApp(): Promise<
  readonly ProductOperationDescriptor[]
> {
  const { harness } = await composeCatalog();
  try {
    return productOperationRegistry.list();
  } finally {
    await harness.close();
  }
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("runManifest — write mode", () => {
  it("skips composition entirely when the manifest is newer than every source", async () => {
    const root = await makeTempRoot();
    const source = join(root, "app.ts");
    const manifestPath = join(root, "manifest.json");
    await writeFile(source, "// source\n");
    await writeFile(manifestPath, "stale-but-newer\n");
    await setMtime(source, 1_000);
    await setMtime(manifestPath, 2_000);

    let composeCalls = 0;
    const result = await runManifest({
      mode: MANIFEST_MODE.WRITE,
      manifestPath,
      sourceRoots: [source],
      collectOperations: async () => {
        composeCalls += 1;
        return [SAMPLE];
      },
    });

    expect(result).toStrictEqual({
      ok: true,
      value: MANIFEST_OUTCOME.SKIPPED_CURRENT,
    });
    expect(composeCalls).toBe(0);
    expect(await readFile(manifestPath, "utf8")).toBe("stale-but-newer\n");
  });

  it("composes and writes when a source is newer than the manifest", async () => {
    const root = await makeTempRoot();
    const source = join(root, "app.ts");
    const manifestPath = join(root, "manifest.json");
    await writeFile(source, "// source\n");
    await writeFile(manifestPath, "outdated\n");
    await setMtime(manifestPath, 1_000);
    await setMtime(source, 2_000);

    let composeCalls = 0;
    const result = await runManifest({
      mode: MANIFEST_MODE.WRITE,
      manifestPath,
      sourceRoots: [source],
      collectOperations: async () => {
        composeCalls += 1;
        return [SAMPLE];
      },
    });

    expect(result).toStrictEqual({
      ok: true,
      value: MANIFEST_OUTCOME.REGENERATED,
    });
    expect(composeCalls).toBe(1);
    expect(await readFile(manifestPath, "utf8")).toBe(renderManifest([SAMPLE]));
  });

  it("refuses to write an empty catalog and leaves the file untouched", async () => {
    const root = await makeTempRoot();
    const source = join(root, "app.ts");
    const manifestPath = join(root, "manifest.json");
    await writeFile(source, "// source\n");
    await writeFile(manifestPath, "outdated\n");
    await setMtime(manifestPath, 1_000);
    await setMtime(source, 2_000);

    const result = await runManifest({
      mode: MANIFEST_MODE.WRITE,
      manifestPath,
      sourceRoots: [source],
      collectOperations: async () => [],
    });

    expect(result).toStrictEqual({
      ok: false,
      error: MANIFEST_FAILURE.EMPTY_CATALOG,
    });
    expect(await readFile(manifestPath, "utf8")).toBe("outdated\n");
  });
});

describe("runManifest — check mode", () => {
  it("composes even when the manifest is newer, and fails on wrong content", async () => {
    const root = await makeTempRoot();
    const source = join(root, "app.ts");
    const manifestPath = join(root, "manifest.json");
    await writeFile(source, "// source\n");
    await writeFile(manifestPath, `${JSON.stringify({ operations: [] })}\n`);
    await setMtime(source, 1_000);
    await setMtime(manifestPath, 9_000_000);

    let composeCalls = 0;
    const result = await runManifest({
      mode: MANIFEST_MODE.CHECK,
      manifestPath,
      sourceRoots: [source],
      collectOperations: async () => {
        composeCalls += 1;
        return collectFromComposedApp();
      },
    });

    expect(composeCalls).toBe(1);
    expect(result).toStrictEqual({ ok: false, error: MANIFEST_FAILURE.DRIFT });
  });

  it("passes when the committed bytes equal the render, and writes nothing", async () => {
    const root = await makeTempRoot();
    const manifestPath = join(root, "manifest.json");
    await writeFile(manifestPath, renderManifest([SAMPLE]));
    const before = await stat(manifestPath);

    const result = await runManifest({
      mode: MANIFEST_MODE.CHECK,
      manifestPath,
      sourceRoots: [],
      collectOperations: async () => [SAMPLE],
    });

    expect(result).toStrictEqual({
      ok: true,
      value: MANIFEST_OUTCOME.VERIFIED,
    });
    expect((await stat(manifestPath)).mtimeMs).toBe(before.mtimeMs);
  });

  it("fails when the manifest is missing", async () => {
    const root = await makeTempRoot();
    const result = await runManifest({
      mode: MANIFEST_MODE.CHECK,
      manifestPath: join(root, "absent.json"),
      sourceRoots: [],
      collectOperations: async () => [SAMPLE],
    });
    expect(result).toStrictEqual({ ok: false, error: MANIFEST_FAILURE.DRIFT });
  });
});

describe("generate-manifest bin", () => {
  it("reports the manifest as current without rewriting it", async () => {
    const now = Date.now() / 1_000;
    await setMtime(REAL_MANIFEST, now);
    const before = await readFile(REAL_MANIFEST, "utf8");
    const beforeStat = await stat(REAL_MANIFEST);

    const { stdout } = await run(TSX, [GENERATOR], { cwd: PACKAGE_ROOT });

    expect(stdout).toContain("product-operations manifest is current");
    expect(await readFile(REAL_MANIFEST, "utf8")).toBe(before);
    expect((await stat(REAL_MANIFEST)).mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it("regenerates after a route source changes", async () => {
    const now = Date.now() / 1_000;
    await setMtime(REAL_MANIFEST, now - 60);
    await setMtime(REAL_ROUTE_SOURCE, now);
    const before = await readFile(REAL_MANIFEST, "utf8");

    const { stdout } = await run(TSX, [GENERATOR], { cwd: PACKAGE_ROOT });

    expect(stdout).toContain("product-operations manifest regenerated");
    expect(await readFile(REAL_MANIFEST, "utf8")).toBe(before);
  }, 60_000);
});
