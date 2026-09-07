import { describe, expect, it } from "vitest";

import { lintFixture, type Diagnostic } from "./run-oxlint";

function expectLines(
  rule: string,
  file: string,
  lines: readonly number[],
): void {
  const expected: Diagnostic[] = lines.map((line) => ({ rule, line }));
  expect(lintFixture(rule, file)).toEqual(expected);
}

describe("house/no-enum", () => {
  it("reports every enum declaration, const enum included", () => {
    expectLines("no-enum", "bad.ts", [1, 5]);
  });

  it("passes an as const map", () => {
    expectLines("no-enum", "good.ts", []);
  });
});

describe("house/extensionless-import", () => {
  it("reports every relative specifier that carries a ts or js extension", () => {
    expectLines("extensionless-import", "bad.ts", [1, 2, 3, 4, 5, 6, 7]);
  });

  it("passes bare packages, assets and extensionless relatives", () => {
    expectLines("extensionless-import", "good.ts", []);
  });
});

describe("house/no-raw-button", () => {
  it("reports each raw button opening element", () => {
    expectLines("no-raw-button", "bad.tsx", [4, 5]);
  });

  it("passes the shared component", () => {
    expectLines("no-raw-button", "good.tsx", []);
  });

  it("honours a line disable naming the house rule", () => {
    expectLines("no-raw-button", "disabled.tsx", []);
  });
});

describe("house/no-blank-target", () => {
  it("reports target blank on a raw anchor", () => {
    expectLines("no-blank-target", "bad.tsx", [3]);
  });

  it("passes other targets and the shared link", () => {
    expectLines("no-blank-target", "good.tsx", []);
  });
});
