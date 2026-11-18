import { describe, expect, it } from "vitest";

import {
  checkNoticesVersion,
  readLockfileElkjsVersions,
  readLockfileLibvipsVersions,
} from "../../src/logic/notices";

function makeLockfile(...keys: string[]): string {
  const entries = keys.map((key) => `  '${key}':\n    resolution: {}\n`);
  return `lockfileVersion: '9.0'\n\npackages:\n\n${entries.join("\n")}`;
}

function makeSources(version: string, elkjsVersion?: string): string {
  const elkjs =
    elkjsVersion === undefined
      ? ""
      : `## elkjs\n\nelkjs version: ${elkjsVersion}\n`;
  return `# Sources\n\nsharp-libvips version: ${version}\n\nmore text\n${elkjs}`;
}

const LOCKFILE = makeLockfile(
  "@img/sharp-libvips-darwin-arm64@1.3.4",
  "@img/sharp-libvips-linuxmusl-x64@1.3.4",
  "@img/sharp-linuxmusl-x64@0.35.5",
  "sharp@0.35.5",
);

const LOCKFILE_WITH_ELKJS = makeLockfile(
  "@img/sharp-libvips-linuxmusl-x64@1.3.4",
  "elkjs@0.9.3",
  "mermaid@12.2.0",
);

describe("readLockfileLibvipsVersions", () => {
  it("reads each distinct libvips version across the platform builds", () => {
    expect(readLockfileLibvipsVersions(LOCKFILE)).toEqual(["1.3.4"]);
  });

  it("reads a snapshot key with its peer suffix", () => {
    const lockfile = makeLockfile("@img/sharp-libvips-linux-x64@1.3.5(a@1)");

    expect(readLockfileLibvipsVersions(lockfile)).toEqual(["1.3.5"]);
  });

  it("reads nothing from a lockfile without sharp", () => {
    expect(readLockfileLibvipsVersions(makeLockfile("zod@4.1.0"))).toEqual([]);
  });
});

describe("readLockfileElkjsVersions", () => {
  it("reads the elkjs version and no package that only starts with it", () => {
    const lockfile = makeLockfile("elkjs@0.9.3", "elkjs-svg@0.2.0");

    expect(readLockfileElkjsVersions(lockfile)).toEqual(["0.9.3"]);
  });
});

describe("checkNoticesVersion", () => {
  it("passes when the folder records the lockfile's version", () => {
    expect(checkNoticesVersion(LOCKFILE, makeSources("1.3.4"))).toEqual({
      ok: true,
      value: { libvips: "1.3.4" },
    });
  });

  it("passes when the folder records both lockfile versions", () => {
    const checked = checkNoticesVersion(
      LOCKFILE_WITH_ELKJS,
      makeSources("1.3.4", "0.9.3"),
    );

    expect(checked).toEqual({
      ok: true,
      value: { libvips: "1.3.4", elkjs: "0.9.3" },
    });
  });

  it("refuses a folder recording another elkjs version", () => {
    const checked = checkNoticesVersion(
      LOCKFILE_WITH_ELKJS,
      makeSources("1.3.4", "0.9.2"),
    );

    expect(!checked.ok && checked.error).toMatch(
      /records elkjs 0\.9\.2 but the lockfile holds 0\.9\.3; run pnpm -C tools\/release notices/,
    );
  });

  it("refuses a lockfile holding elkjs the folder does not record", () => {
    const checked = checkNoticesVersion(
      LOCKFILE_WITH_ELKJS,
      makeSources("1.3.4"),
    );

    expect(!checked.ok && checked.error).toMatch(
      /lockfile holds elkjs 0\.9\.3 but .* records none/,
    );
  });

  it("refuses a folder recording elkjs the lockfile no longer holds", () => {
    const checked = checkNoticesVersion(
      LOCKFILE,
      makeSources("1.3.4", "0.9.3"),
    );

    expect(!checked.ok && checked.error).toMatch(
      /records elkjs 0\.9\.3 but the lockfile holds none/,
    );
  });

  it("refuses a folder recording another version", () => {
    const checked = checkNoticesVersion(LOCKFILE, makeSources("1.3.3"));

    expect(checked.ok).toBe(false);
    expect(!checked.ok && checked.error).toMatch(
      /records sharp-libvips 1\.3\.3 but the lockfile holds 1\.3\.4/,
    );
  });

  it("refuses a lockfile holding libvips with no notices folder", () => {
    const checked = checkNoticesVersion(LOCKFILE, undefined);

    expect(!checked.ok && checked.error).toMatch(
      /pnpm -C tools\/release notices/,
    );
  });

  it("refuses a sources file that records no version", () => {
    const checked = checkNoticesVersion(LOCKFILE, "# Sources\n");

    expect(!checked.ok && checked.error).toMatch(
      /records no sharp-libvips version/,
    );
  });

  it("refuses two libvips versions in one lockfile", () => {
    const lockfile = makeLockfile(
      "@img/sharp-libvips-linux-x64@1.3.4",
      "@img/sharp-libvips-linux-arm64@1.3.5",
    );

    const checked = checkNoticesVersion(lockfile, makeSources("1.3.4"));

    expect(!checked.ok && checked.error).toMatch(/1\.3\.4, 1\.3\.5/);
  });

  it("refuses a folder left behind once libvips is gone", () => {
    const lockfile = makeLockfile("zod@4.1.0");

    const checked = checkNoticesVersion(lockfile, makeSources("1.3.4"));

    expect(!checked.ok && checked.error).toMatch(/no @img\/sharp-libvips-/);
  });

  it("passes a tree that ships neither", () => {
    const checked = checkNoticesVersion(makeLockfile("zod@4.1.0"), undefined);

    expect(checked).toEqual({ ok: true, value: {} });
  });
});
