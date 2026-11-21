// The `held:` line `pr <n>` prints under a held head.
import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";
import type { DescribableCondition } from "i18n";
import type { UnmetPlainCondition } from "types/trigger-conditions";
import type { heldPlainConditionSchema } from "../src/commands/read/held-items";
import { formatHeldLine } from "../src/commands/read/held-line";

type IsAssignable<From, To> = [From] extends [To] ? true : false;

/** The CLI reads every condition the server stores, and the describer takes what it reads. */
const HELD_CONDITION_PINS = {
  readsEveryStoredCondition: true satisfies IsAssignable<
    UnmetPlainCondition,
    z.input<typeof heldPlainConditionSchema>
  >,
  describesWhatItReads: true satisfies IsAssignable<
    z.output<typeof heldPlainConditionSchema>,
    DescribableCondition
  >,
};
void HELD_CONDITION_PINS;

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
          { kind: "labels", setBy: "repo", labels: ["needs-brief"] },
        ],
      },
      { kind: "ready-for-review", setBy: "instance" },
      {
        kind: "ci",
        setBy: "repo",
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
      { kind: "moon-phase", setBy: "repo" },
      { kind: "never", setBy: "repo" },
    ]);

    expect(line).toBe(
      "held: Generates only when someone presses Generate (this repository's setting); moon-phase\n",
    );
  });

  it.each([
    ["a missing list", undefined],
    ["an empty list", []],
    ["a list of unreadable items", [{ setBy: "repo" }, 7]],
  ])("says the conditions are unmet for %s", (_case, items) => {
    expect(formatHeldLine("held", items)).toBe(
      "held: trigger conditions not met\n",
    );
  });

  it("says some conditions went unread when the server read part", () => {
    const line = formatHeldLine(
      "held",
      [{ kind: "never", setBy: "repo" }],
      true,
    );

    expect(line).toBe(
      "held: Generates only when someone presses Generate (this repository's setting); Conditions this server could not read\n",
    );
  });

  it("names only the unread conditions when the server read none", () => {
    expect(formatHeldLine("held", [], true)).toBe(
      "held: Conditions this server could not read\n",
    );
  });

  it("prints an any group's unknown member raw inside the group", () => {
    const line = formatHeldLine("held", [
      {
        kind: "any",
        conditions: [
          { kind: "moon-phase", setBy: "repo" },
          { kind: "never", setBy: "repo" },
        ],
      },
    ]);

    expect(line).toBe(
      "held: Needs one of these: Generates only when someone presses Generate (this repository's setting) or moon-phase\n",
    );
  });

  it("names a bot whose verdict this build predates", () => {
    const line = formatHeldLine("held", [
      {
        kind: "bots",
        setBy: "repo",
        bot: "coderabbit",
        verdict: "merged-with-notes",
        state: "running",
      },
    ]);

    expect(line).toBe(
      "held: Waiting for CodeRabbit to finish (this repository's setting)\n",
    );
  });

  it("escapes control characters in third-party names", () => {
    const line = formatHeldLine("held", [
      { kind: "labels", setBy: "repo", labels: ["evil\u001b[31m"] },
    ]);

    expect(line).not.toContain("\u001b");
  });
});
