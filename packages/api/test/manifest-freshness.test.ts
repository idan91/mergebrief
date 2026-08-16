// The write path's short-circuit: the committed manifest is current when it
// is strictly newer than every file that can change what composition renders.
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  decideManifestFreshness,
  fileMtimeMs,
  MANIFEST_FRESHNESS,
  newestMtimeMs,
} from "../scripts/manifest-freshness";

const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "manifest-freshness-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("decideManifestFreshness", () => {
  it("is fresh when the manifest is strictly newer than every source", () => {
    expect(
      decideManifestFreshness({
        manifestMtimeMs: 2_000,
        newestSourceMtimeMs: 1_000,
      }),
    ).toBe(MANIFEST_FRESHNESS.FRESH);
  });

  it("is stale when a source is newer than the manifest", () => {
    expect(
      decideManifestFreshness({
        manifestMtimeMs: 1_000,
        newestSourceMtimeMs: 2_000,
      }),
    ).toBe(MANIFEST_FRESHNESS.STALE);
  });

  it("treats equal timestamps as stale (filesystem granularity is coarse)", () => {
    expect(
      decideManifestFreshness({
        manifestMtimeMs: 1_000,
        newestSourceMtimeMs: 1_000,
      }),
    ).toBe(MANIFEST_FRESHNESS.STALE);
  });

  it("is stale when the manifest is missing", () => {
    expect(
      decideManifestFreshness({
        manifestMtimeMs: undefined,
        newestSourceMtimeMs: 1_000,
      }),
    ).toBe(MANIFEST_FRESHNESS.STALE);
  });

  it("is stale when no source was found at all", () => {
    expect(
      decideManifestFreshness({
        manifestMtimeMs: 2_000,
        newestSourceMtimeMs: undefined,
      }),
    ).toBe(MANIFEST_FRESHNESS.STALE);
  });
});

describe("newestMtimeMs", () => {
  it("walks nested directories and returns the newest mtime it saw", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "src", "routes"), { recursive: true });
    const older = join(root, "src", "app.ts");
    const newer = join(root, "src", "routes", "pulls.ts");
    await writeFile(older, "// older\n");
    await writeFile(newer, "// newer\n");
    await utimes(older, new Date(1_000_000), new Date(1_000_000));
    await utimes(newer, new Date(2_000_000), new Date(2_000_000));
    await utimes(
      join(root, "src", "routes"),
      new Date(1_500_000),
      new Date(1_500_000),
    );
    await utimes(join(root, "src"), new Date(1_500_000), new Date(1_500_000));

    expect(await newestMtimeMs([join(root, "src")])).toBe(2_000_000);
  });

  it("counts a directory's own mtime, so a deletion still reads as newer", async () => {
    const root = await makeTempRoot();
    await mkdir(join(root, "src"), { recursive: true });
    const file = join(root, "src", "app.ts");
    await writeFile(file, "// file\n");
    await utimes(file, new Date(1_000_000), new Date(1_000_000));
    await utimes(join(root, "src"), new Date(3_000_000), new Date(3_000_000));

    expect(await newestMtimeMs([join(root, "src")])).toBe(3_000_000);
  });

  it("accepts plain files as roots and ignores paths that do not exist", async () => {
    const root = await makeTempRoot();
    const file = join(root, "package.json");
    await writeFile(file, "{}\n");
    await utimes(file, new Date(1_234_000), new Date(1_234_000));

    expect(await newestMtimeMs([file, join(root, "absent")])).toBe(1_234_000);
  });

  it("returns undefined when nothing exists", async () => {
    const root = await makeTempRoot();
    expect(await newestMtimeMs([join(root, "absent")])).toBeUndefined();
  });
});

describe("fileMtimeMs", () => {
  it("returns undefined for a missing file", async () => {
    const root = await makeTempRoot();
    expect(await fileMtimeMs(join(root, "absent.json"))).toBeUndefined();
  });

  it("returns the mtime of an existing file", async () => {
    const root = await makeTempRoot();
    const file = join(root, "manifest.json");
    await writeFile(file, "{}\n");
    await utimes(file, new Date(5_000_000), new Date(5_000_000));
    expect(await fileMtimeMs(file)).toBe(5_000_000);
  });
});
