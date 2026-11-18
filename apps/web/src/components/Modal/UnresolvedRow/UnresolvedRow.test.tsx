// @vitest-environment jsdom
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  compileStylesheet,
  parseCompiledRules,
  resolveInheritedDeclaration,
  scopeCompiledRules,
  type CompiledRule,
} from "@web/test/compiled-css";
import { UnresolvedRow } from ".";
import rowStyles from "./UnresolvedRow.module.scss";

const ROW_STYLESHEET = join(
  dirname(fileURLToPath(import.meta.url)),
  "UnresolvedRow.module.scss",
);
const LONG_RISK_LABEL = "Touches a repo defined attribute with a long name";

afterEach(cleanup);

function renderRow(): CompiledRule[] {
  render(
    <ul>
      <UnresolvedRow
        path="packages/brief-core/src/anchoring/plan.ts"
        riskLabel={LONG_RISK_LABEL}
        onClick={() => {}}
      />
    </ul>,
  );
  const css = compileStylesheet(ROW_STYLESHEET);
  return scopeCompiledRules(parseCompiledRules(css), rowStyles);
}

describe("UnresolvedRow", () => {
  it("wraps a long risk label inside the row instead of overflowing it", () => {
    const rules = renderRow();
    const label = screen.getByText(LONG_RISK_LABEL);

    expect(resolveInheritedDeclaration(label, rules, "flex")).toBe("0 1 auto");
    expect(resolveInheritedDeclaration(label, rules, "min-inline-size")).toBe(
      "0",
    );
    expect(resolveInheritedDeclaration(label, rules, "overflow-wrap")).toBe(
      "anywhere",
    );
  });

  it("drops the path under the label once the row runs short of room", () => {
    const rules = renderRow();
    const fileName = screen.getByText("plan.ts");
    const path = fileName.parentElement!;

    expect(resolveInheritedDeclaration(path, rules, "flex")).toBe("1 1 10rem");
  });
});
