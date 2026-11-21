// The `held:` line `pr <n>` prints under a held head.
import { describe, expect, it } from "vitest";
import { formatHeldLine } from "../src/commands/read/held-line";

describe("formatHeldLine", () => {
  it("prints nothing for a head that is not held", () => {
    expect(formatHeldLine("pending", [])).toBeUndefined();
    expect(formatHeldLine(undefined, undefined)).toBeUndefined();
  });

  it("names every check, waits first, the group last", () => {
    const line = formatHeldLine("held", [
      {
        kind: "any",
        conditions: [
          { kind: "labels", source: "repo", labels: ["needs-brief"] },
        ],
      },
      { kind: "ready-for-review", source: "instance" },
      {
        kind: "ci",
        source: "repo",
        failed: [],
        running: ["build", "lint", "test", "e2e"],
        missing: [],
        permissionMissing: false,
      },
    ]);

    expect(line).toBe(
      "held: Waiting for CI: build, lint, test, e2e still running (this repository's setting); " +
        "Needs this pull request marked ready for review (this MergeBrief instance's setting); " +
        "Needs one of these: Needs the label needs-brief (this repository's setting)\n",
    );
  });

  it("prints an unknown kind raw beside the ones it knows", () => {
    const line = formatHeldLine("held", [
      { kind: "moon-phase", source: "repo" },
      { kind: "never", source: "repo" },
    ]);

    expect(line).toBe(
      "held: Generates only when someone presses Generate (this repository's setting); moon-phase\n",
    );
  });

  it.each([
    ["a missing list", undefined],
    ["an empty list", []],
    ["a list of unreadable items", [{ source: "repo" }, 7]],
  ])("says the conditions are unmet for %s", (_case, items) => {
    expect(formatHeldLine("held", items)).toBe(
      "held: trigger conditions not met\n",
    );
  });

  it("escapes control characters in third-party names", () => {
    const line = formatHeldLine("held", [
      { kind: "labels", source: "repo", labels: ["evil\u001b[31m"] },
    ]);

    expect(line).not.toContain("\u001b");
  });
});
