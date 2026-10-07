import { describe, expect, it } from "vitest";

import { lintFixture, type Diagnostic } from "./run-oxlint";
import { readMarkedLines } from "./utils";

function expectLines(
  rule: string,
  file: string,
  lines: readonly number[],
): void {
  const expected: Diagnostic[] = lines.map((line) => ({ rule, line }));
  expect(lintFixture(rule, file)).toEqual(expected);
}

function expectMarkedLines(rule: string, file: string): void {
  expectLines(rule, file, readMarkedLines(rule, file));
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

describe("house/no-conditional-spread", () => {
  it("reports a ternary, and, coalesce and call-argument spread", () => {
    expectLines("no-conditional-spread", "bad.ts", [5, 6, 7, 8]);
  });

  it("passes a plain spread, assign-under-if and an array spread", () => {
    expectLines("no-conditional-spread", "good.ts", []);
  });
});

describe("house/test-title", () => {
  it("reports long titles and parentheticals in every vitest form", () => {
    expectLines("test-title", "bad.ts", [3, 4, 5, 6, 7, 8, 9]);
  });

  it("passes short titles, the cap itself and a template with expressions", () => {
    expectLines("test-title", "good.ts", []);
  });
});

describe("house/comment-run", () => {
  it("reports a line run and a JSDoc block of five content lines", () => {
    expectLines("comment-run", "bad.ts", [1, 8]);
  });

  it("passes four-line runs split by code and a trailing comment", () => {
    expectLines("comment-run", "good.ts", []);
  });
});

describe("house/comment-density", () => {
  it("reports a file that is more comment than code", () => {
    expectLines("comment-density", "bad.ts", [5]);
  });

  it("passes a file with one comment and real code", () => {
    expectLines("comment-density", "good.ts", []);
  });
});

describe("house/no-em-dash", () => {
  it("reports an em-dash in a line comment, a block comment and a title", () => {
    expectLines("no-em-dash", "bad.ts", [3, 6, 9]);
  });

  it("passes hyphens and double dashes", () => {
    expectLines("no-em-dash", "good.ts", []);
  });
});

describe("house/no-render-function", () => {
  it("reports a render-prefixed arrow const and function declaration", () => {
    expectLines("no-render-function", "bad.tsx", [2, 4]);
  });

  it("passes a sub-component and a render-prefixed prop", () => {
    expectLines("no-render-function", "good.tsx", []);
  });
});

describe("house/no-process-env", () => {
  it("reports both process imports and every way of reaching env", () => {
    expectLines("no-process-env", "bad.ts", [1, 2, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("passes an injected env map and other process members", () => {
    expectLines("no-process-env", "good.ts", []);
  });
});

describe("house/types-const-maps", () => {
  it("reports functions, classes and values that are not as const maps", () => {
    expectLines("types-const-maps", "bad.ts", [1, 5, 7, 9, 11]);
  });

  it("passes an as const map plus type and interface exports", () => {
    expectLines("types-const-maps", "good.ts", []);
  });
});

describe("house/no-re-export", () => {
  it("reports every re-export form in a non-barrel file", () => {
    expectMarkedLines("no-re-export", "bad.ts");
  });

  it("reports an export assignment of an imported name", () => {
    expectMarkedLines("no-re-export", "bad-export-assignment.ts");
  });

  it("passes own declarations, instantiations and member reads", () => {
    expectLines("no-re-export", "good.ts", []);
  });

  it("passes a framework config default-exporting its own value", () => {
    expectLines("no-re-export", "good-config/vite.config.ts", []);
  });

  it("reports a barrel re-exporting a package, itself or a climbing path", () => {
    expectMarkedLines("no-re-export", "bad-barrel/index.ts");
  });

  it("passes a barrel re-exporting files inside its own folder", () => {
    expectLines("no-re-export", "good-barrel/index.ts", []);
    expectLines("no-re-export", "good-barrel-tsx/index.tsx", []);
  });

  it("honours a line disable naming the house rule", () => {
    expectLines("no-re-export", "disabled.ts", []);
  });
});

describe("house/no-hand-built-plural", () => {
  it("reports a conditional whose branches are the empty string and s", () => {
    expectLines("no-hand-built-plural", "bad.ts", [2, 3]);
  });

  it("passes a count key and an unrelated conditional", () => {
    expectLines("no-hand-built-plural", "good.ts", []);
  });
});

describe("house/no-shout-case-copy", () => {
  it("reports copy anywhere under a SHOUT_CASE const", () => {
    expectMarkedLines("no-shout-case-copy", "bad.ts");
  });

  it("reports JSX text under a SHOUT_CASE const", () => {
    expectMarkedLines("no-shout-case-copy", "bad.tsx");
  });

  it("passes catalog keys, label maps and technical consts", () => {
    expectLines("no-shout-case-copy", "good.ts", []);
  });

  it("passes a component that resolves a label key with t", () => {
    expectLines("no-shout-case-copy", "good.tsx", []);
  });

  it("passes ignored callees, comparisons and ignored keys", () => {
    expectLines("no-shout-case-copy", "ignored.ts", []);
  });

  it("passes ignored JSX attributes under a SHOUT_CASE const", () => {
    expectLines("no-shout-case-copy", "ignored.tsx", []);
  });
});
