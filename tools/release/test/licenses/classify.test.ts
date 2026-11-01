import { describe, expect, it } from "vitest";

import { classifyLicenses } from "../../src/logic/licenses/classify";
import type { LicensedPackage } from "../../src/logic/licenses/types";

function makePackage(name: string, license: string): LicensedPackage {
  return { name, versions: ["1.0.0"], license };
}

const FONT_PACKAGE = "@fontsource/ibm-plex-sans";

describe("the shipped-graph license classifier", () => {
  it("passes a tree of permissive licenses", () => {
    const result = classifyLicenses([
      makePackage("commander", "MIT"),
      makePackage("zod", "MIT"),
      makePackage("semver", "ISC"),
    ]);

    expect(result).toEqual({ ok: true, value: { checked: 3, excepted: [] } });
  });

  it("fails a GPL-3.0 package and names it", () => {
    const gpl = makePackage("copyleft-lib", "GPL-3.0");

    const result = classifyLicenses([makePackage("zod", "MIT"), gpl]);

    expect(result).toEqual({ ok: false, error: [gpl] });
  });

  it("fails a package whose license pnpm could not read", () => {
    const unknown = makePackage("mystery", "Unknown");

    expect(classifyLicenses([unknown])).toEqual({
      ok: false,
      error: [unknown],
    });
  });

  it("passes an OR expression when one branch is allowed", () => {
    const result = classifyLicenses([makePackage("dual", "(MIT OR GPL-3.0)")]);

    expect(result.ok).toBe(true);
  });

  it("fails an AND expression unless every branch is allowed", () => {
    const mixed = makePackage("mixed", "(MIT AND GPL-3.0)");
    const both = makePackage("both", "MIT AND Apache-2.0");

    expect(classifyLicenses([mixed, both])).toEqual({
      ok: false,
      error: [mixed],
    });
  });

  it("binds AND tighter than OR", () => {
    const result = classifyLicenses([
      makePackage("precedence", "MIT OR GPL-3.0 AND AGPL-3.0"),
    ]);

    expect(result.ok).toBe(true);
  });

  it("fails an expression it cannot fully resolve", () => {
    const unresolved = [
      makePackage("with-exception", "Apache-2.0 WITH LLVM-exception"),
      makePackage("or-later", "MIT+"),
      makePackage("unbalanced", "(MIT OR ISC"),
      makePackage("dangling", "MIT OR"),
      makePackage("lowercase-operator", "MIT or ISC"),
      makePackage("empty", ""),
    ];

    expect(classifyLicenses(unresolved)).toEqual({
      ok: false,
      error: unresolved,
    });
  });

  it("passes a named exception and carries its reason", () => {
    const font = makePackage(FONT_PACKAGE, "OFL-1.1");

    const result = classifyLicenses([font]);

    expect(result.ok).toBe(true);
    const excepted = result.ok ? result.value.excepted : [];
    expect(excepted).toHaveLength(1);
    expect(excepted[0]?.name).toBe(FONT_PACKAGE);
    expect(excepted[0]?.reason).toMatch(/redistributed/);
  });

  it("drops the exception once the excepted package changes license", () => {
    const relicensed = makePackage(FONT_PACKAGE, "GPL-3.0");

    expect(classifyLicenses([relicensed])).toEqual({
      ok: false,
      error: [relicensed],
    });
  });

  it("passes every platform build under a prefix exception", () => {
    const builds = [
      makePackage("@img/sharp-libvips-linuxmusl-x64", "LGPL-3.0-or-later"),
      makePackage("@img/sharp-libvips-darwin-arm64", "LGPL-3.0-or-later"),
    ];

    const result = classifyLicenses(builds);

    const excepted = result.ok ? result.value.excepted : [];
    expect(excepted.map((pkg) => pkg.name)).toEqual([
      "@img/sharp-libvips-linuxmusl-x64",
      "@img/sharp-libvips-darwin-arm64",
    ]);
    expect(excepted[0]?.reason).toMatch(/LGPL-3.0/);
  });

  it("keeps a prefix exception to its prefix and its license", () => {
    const lookalike = makePackage("@img/sharp-libvipsx", "LGPL-3.0-or-later");
    const relicensed = makePackage("@img/sharp-libvips-linux-x64", "GPL-3.0");

    expect(classifyLicenses([lookalike, relicensed])).toEqual({
      ok: false,
      error: [lookalike, relicensed],
    });
  });
});
