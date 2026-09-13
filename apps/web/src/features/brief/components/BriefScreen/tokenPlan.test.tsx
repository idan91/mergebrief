// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GrammarNames } from "@web/utils/diffTokens/types";
import type { BriefChunk } from "../../types";
import { TokenPlanProvider, useTokenPlan } from "./tokenPlan";

const warmDiffTokenWorker = vi.hoisted(() => vi.fn());

vi.mock("@web/utils/diffTokens/client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, warmDiffTokenWorker };
});

afterEach(() => {
  cleanup();
  warmDiffTokenWorker.mockClear();
});

function makeChunk(file: string, rowCount: number): BriefChunk {
  const diff = Array.from({ length: rowCount }, (_, index) => ({
    kind: "add" as const,
    content: `line ${String(index)}`,
    newLine: index + 1,
  }));
  return { id: `c-${file}`, file, diff } as BriefChunk;
}

function PlanProbe() {
  const plan = useTokenPlan();
  return (
    <output>
      {plan.briefKey}:{[...plan.admitted].join(",")}
    </output>
  );
}

describe("TokenPlanProvider", () => {
  it("admits the grammars the brief's chunks need", () => {
    render(
      <TokenPlanProvider briefKey="brief-1" chunks={[makeChunk("a.ts", 3)]}>
        <PlanProbe />
      </TokenPlanProvider>,
    );

    expect(screen.getByRole("status").textContent).toBe(
      `brief-1:${GrammarNames.TYPESCRIPT}`,
    );
  });

  it("warms the worker once with the admitted grammars", () => {
    render(
      <TokenPlanProvider briefKey="brief-1" chunks={[makeChunk("a.ts", 3)]}>
        <PlanProbe />
      </TokenPlanProvider>,
    );

    expect(warmDiffTokenWorker).toHaveBeenCalledTimes(1);
    expect(warmDiffTokenWorker).toHaveBeenCalledWith("brief-1", [
      GrammarNames.TYPESCRIPT,
    ]);
  });

  it("reads as an empty plan outside a provider", () => {
    render(<PlanProbe />);

    expect(screen.getByRole("status").textContent).toBe(":");
  });
});
