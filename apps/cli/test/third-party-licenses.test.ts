import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildThirdPartyLicenses,
  formatThirdPartyLicenses,
  getBundledPackageDirs,
  readBundledLicense,
} from "../scripts/third-party-licenses";

const SCRATCH_PREFIX = join(tmpdir(), "mb-notices-");

function makePackageDir(files: Record<string, string>): string {
  const packageDir = mkdtempSync(SCRATCH_PREFIX);
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(packageDir, name), contents);
  }
  return packageDir;
}

const MANIFEST = JSON.stringify({
  name: "commander",
  version: "14.0.3",
  license: "MIT",
});

describe("getBundledPackageDirs", () => {
  it("names each installed package once, scoped names included", () => {
    const inputs = [
      "../../node_modules/.pnpm/commander@14.0.3/node_modules/commander/lib/command.js",
      "../../node_modules/.pnpm/commander@14.0.3/node_modules/commander/index.js",
      "../../node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/classic/schemas.js",
      "../../node_modules/.pnpm/@scope+pkg@1.0.0/node_modules/@scope/pkg/index.js",
    ];

    expect(getBundledPackageDirs(inputs)).toEqual([
      "../../node_modules/.pnpm/@scope+pkg@1.0.0/node_modules/@scope/pkg",
      "../../node_modules/.pnpm/commander@14.0.3/node_modules/commander",
      "../../node_modules/.pnpm/zod@4.6.5/node_modules/zod",
    ]);
  });

  it("leaves out workspace sources, which carry no node_modules segment", () => {
    const inputs = [
      "src/bin.ts",
      "../../packages/i18n/src/index.ts",
      "../../packages/contract/src/index.ts",
    ];

    expect(getBundledPackageDirs(inputs)).toEqual([]);
  });
});

describe("readBundledLicense", () => {
  it("reads the name, version, license id and license text", () => {
    const packageDir = makePackageDir({
      "package.json": MANIFEST,
      "LICENSE.md": "Copyright (c) 2011 TJ Holowaychuk\n",
    });

    expect(readBundledLicense(packageDir)).toEqual({
      ok: true,
      value: {
        name: "commander",
        version: "14.0.3",
        license: "MIT",
        text: "Copyright (c) 2011 TJ Holowaychuk",
      },
    });
  });

  it("refuses a package whose package.json is not JSON", () => {
    const packageDir = makePackageDir({ "package.json": "{ not json" });

    expect(readBundledLicense(packageDir)).toEqual({
      ok: false,
      error: expect.stringContaining(
        `${packageDir} has a malformed package.json`,
      ),
    });
  });

  it("refuses a package whose manifest has no name and version", () => {
    const packageDir = makePackageDir({
      "package.json": JSON.stringify({ license: "MIT" }),
      LICENSE: "MIT text",
    });

    expect(readBundledLicense(packageDir)).toEqual({
      ok: false,
      error: `${packageDir} has no name and version`,
    });
  });

  it("refuses a package whose manifest names no license", () => {
    const packageDir = makePackageDir({
      "package.json": JSON.stringify({ name: "commander", version: "14.0.3" }),
      LICENSE: "MIT text",
    });

    expect(readBundledLicense(packageDir)).toEqual({
      ok: false,
      error: "commander@14.0.3 names no license",
    });
  });

  it("refuses a package that ships no license file", () => {
    const packageDir = makePackageDir({ "package.json": MANIFEST });

    expect(readBundledLicense(packageDir)).toEqual({
      ok: false,
      error: "commander@14.0.3 ships no license file",
    });
  });
});

describe("formatThirdPartyLicenses", () => {
  it("writes one section per package with name, version, id and text", () => {
    const notices = formatThirdPartyLicenses([
      { name: "zod", version: "4.6.5", license: "MIT", text: "MIT text" },
    ]);

    expect(notices).toContain("\nzod 4.6.5\nLicense: MIT\n\nMIT text\n");
  });
});

describe("buildThirdPartyLicenses", () => {
  it("names every bundled package that ships no license file", () => {
    const root = makePackageDir({});
    const packageDir = join(root, "node_modules", "commander");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), MANIFEST);
    const inputs = [`${packageDir}/index.js`];

    expect(buildThirdPartyLicenses(inputs)).toEqual({
      ok: false,
      error: ["commander@14.0.3 ships no license file"],
    });
  });

  it("lists only installed packages, never workspace sources", () => {
    const root = makePackageDir({});
    const packageDir = join(root, "node_modules", "commander");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, "package.json"), MANIFEST);
    writeFileSync(join(packageDir, "LICENSE"), "MIT text");
    const inputs = [
      `${packageDir}/index.js`,
      "../../packages/i18n/src/index.ts",
    ];

    const built = buildThirdPartyLicenses(inputs);

    expect(built.ok && built.value).toContain("commander 14.0.3");
    expect(built.ok && built.value).not.toContain("i18n");
  });
});
