// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BriefReadingSource } from "../components/BriefView/types";
import {
  briefFixture,
  briefSummaryFixture,
} from "@web/features/brief/test-utils";
import { useBriefReading } from "./useBriefReading";

describe("useBriefReading", () => {
  it("carries the revisions and keeps the model while the Brief holds", () => {
    const revisions = { view: { rows: [] }, selectRevision: vi.fn() };
    const source: BriefReadingSource = {
      brief: briefFixture,
      briefId: briefSummaryFixture.id,
      revisions,
    };

    const { result, rerender } = renderHook(
      (input: BriefReadingSource) => useBriefReading(input),
      { initialProps: source },
    );
    const firstModel = result.current.model;
    rerender({ ...source });

    expect(result.current.revisions).toBe(revisions);
    expect(result.current.model).toBe(firstModel);
  });
});
