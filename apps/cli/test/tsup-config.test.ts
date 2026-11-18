import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build, type Options } from "tsup";
import { describe, expect, it } from "vitest";

import cliBuild from "../tsup.config";

const SCRATCH_PREFIX = join(tmpdir(), "mb-build-");

const cliOptions = cliBuild as Options;

const UNLICENSED_PACKAGE = "unlicensed-pkg";

/** An entry that imports one installed package shipping no license file. */
function makeUnlicensedEntry(): string {
  const root = mkdtempSync(SCRATCH_PREFIX);
  const packageDir = join(root, "node_modules", UNLICENSED_PACKAGE);
  mkdirSync(packageDir, { recursive: true });
  const manifest = {
    name: UNLICENSED_PACKAGE,
    version: "1.0.0",
    license: "MIT",
    type: "module",
    main: "index.js",
  };
  writeFileSync(join(packageDir, "package.json"), JSON.stringify(manifest));
  writeFileSync(join(packageDir, "index.js"), 'export const name = "x";\n');

  const entry = join(root, "entry.js");
  writeFileSync(
    entry,
    `import { name } from "${UNLICENSED_PACKAGE}";\nconsole.log(name);\n`,
  );
  return entry;
}

describe("the CLI build", () => {
  it("writes the bundled packages' notices beside the bundle", async () => {
    const outDir = mkdtempSync(SCRATCH_PREFIX);

    await build({ ...cliOptions, outDir, config: false, silent: true });

    const noticesPath = join(outDir, "THIRD_PARTY_LICENSES");
    const notices = readFileSync(noticesPath, "utf8");
    for (const bundled of ["commander", "zod", "i18next"]) {
      expect(notices).toMatch(new RegExp(`^${bundled} \\d`, "m"));
    }
    expect(notices).not.toMatch(/^(?:i18n|contract|types) /m);
  });

  it("fails when a bundled package ships no license file", async () => {
    const outDir = mkdtempSync(SCRATCH_PREFIX);
    const entry = { mergebrief: makeUnlicensedEntry() };

    const built = build({
      ...cliOptions,
      entry,
      outDir,
      config: false,
      silent: true,
    });

    await expect(built).rejects.toThrow(
      `${UNLICENSED_PACKAGE}@1.0.0 ships no license file`,
    );
    expect(existsSync(join(outDir, "THIRD_PARTY_LICENSES"))).toBe(false);
  });
});
