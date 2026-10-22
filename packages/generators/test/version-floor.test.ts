import { describe, expect, it } from "vitest";
import {
  checkCliVersion,
  type CliVersionPolicy,
} from "../src/harness/version-floor";

const POLICY: CliVersionPolicy = {
  cli: "codex",
  tested: "0.163.0",
  updateHint: "update codex",
};

describe("checkCliVersion", () => {
  it("stays silent on the tested version", () => {
    expect(checkCliVersion("codex-cli 0.163.0\n", POLICY)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("refuses an older version, naming both versions", () => {
    const verdict = checkCliVersion("codex-cli 0.150.2\n", POLICY);

    expect(verdict.ok).toBe(false);
    const issues = verdict.ok ? [] : verdict.error.issues;
    expect(issues.join(" ")).toContain("0.150.2");
    expect(issues.join(" ")).toContain("0.163.0");
    expect(issues.join(" ")).toContain("update codex");
  });

  it("warns on a newer version that nobody checked yet", () => {
    const verdict = checkCliVersion("codex-cli 0.170.0\n", POLICY);

    expect(verdict.ok).toBe(true);
    expect(verdict.ok ? verdict.value : null).toContain("newer than 0.163.0");
  });

  it("compares cursor's date versions part by part", () => {
    const cursor: CliVersionPolicy = {
      cli: "cursor-agent",
      tested: "2026.10.19",
      updateHint: "update",
    };

    expect(checkCliVersion("2026.09.30-abc1234", cursor).ok).toBe(false);
    expect(checkCliVersion("2026.10.19-abc1234", cursor)).toEqual({
      ok: true,
      value: null,
    });
  });

  it("warns, never refuses, on output with no version in it", () => {
    const verdict = checkCliVersion("unexpected banner", POLICY);

    expect(verdict.ok).toBe(true);
    expect(verdict.ok ? verdict.value : null).toContain("unverifiable");
  });
});
