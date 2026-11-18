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
} from "@web/test/compiled-css";
import { UnresolvedRow } from "../UnresolvedRow";
import { UnresolvedGroup } from ".";
import groupStyles from "./UnresolvedGroup.module.scss";

const GROUP_STYLESHEET = join(
  dirname(fileURLToPath(import.meta.url)),
  "UnresolvedGroup.module.scss",
);

afterEach(cleanup);

describe("UnresolvedGroup", () => {
  it("stretches each row button across the list's full width", () => {
    render(
      <UnresolvedGroup count={1} heading="Draft comments">
        <UnresolvedRow path="src/a.ts:+3" onClick={() => {}} />
      </UnresolvedGroup>,
    );
    const css = compileStylesheet(GROUP_STYLESHEET);
    const rules = scopeCompiledRules(parseCompiledRules(css), groupStyles);
    const item = screen.getByRole("listitem");

    expect(resolveInheritedDeclaration(item, rules, "display")).toBe("grid");
    expect(
      resolveInheritedDeclaration(item, rules, "grid-template-columns"),
    ).toBe("minmax(0, 1fr)");
  });
});
