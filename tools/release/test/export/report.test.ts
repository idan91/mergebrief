import { describe, expect, it } from "vitest";
import {
  formatExportHeader,
  formatGateVerdict,
  formatLinkHit,
  formatPublishedAction,
  formatPublishPlan,
} from "../../src/logic/export/report";
import {
  GateNames,
  LinkHitKinds,
  PublishActions,
  type PublishPlan,
} from "../../src/logic/export/types";

const PLAN: PublishPlan = {
  version: "0.1.0",
  source: "0123456789abcdef0123456789abcdef01234567",
  commit: "89abcdef0123456789abcdef0123456789abcdef",
  tree: "456789abcdef0123456789abcdef0123456789ab",
  tag: "v0.1.0",
  tagObject: "tttt",
  record: "public/v0.1.0",
  recordObject: "rrrr",
  changes: { added: 3120, edited: 0, deleted: 0 },
  actions: [
    PublishActions.PUSH_COMMIT,
    PublishActions.PUSH_TAG,
    PublishActions.PUSH_RECORD,
  ],
  notices: ["public repo Idan91/mergebrief not found"],
};

describe("the export report", () => {
  it("prints the source, tree and counts per excluded prefix", () => {
    const header = formatExportHeader(
      {
        version: "0.1.0-rc.1",
        commit: "0123456789abcdef0123456789abcdef01234567",
        out: "/tmp/tree",
        fileCount: 3120,
        excluded: [
          { prefix: "docs/internal/", count: 52 },
          { prefix: "docs/plans/", count: 0 },
        ],
      },
      true,
    );

    expect(header).toBe(
      [
        "export 0.1.0-rc.1 (dry run)",
        "  source   0123456789abcdef0123456789abcdef01234567",
        "  tree     /tmp/tree",
        "  files    3120",
        "  excluded docs/internal/ 52",
        "  excluded docs/plans/ 0",
        "",
      ].join("\n"),
    );
  });

  it("prints a passing gate with its notices under it", () => {
    const line = formatGateVerdict({
      name: GateNames.NOTES,
      outcome: {
        ok: true,
        value: { summary: "v0.1.0 ok", notices: ["public repo missing"] },
      },
    });

    expect(line).toBe("gate notes: ok, v0.1.0 ok\n  public repo missing\n");
  });

  it("prints a failing gate with its details under it", () => {
    const line = formatGateVerdict({
      name: GateNames.PATHS,
      outcome: {
        ok: false,
        error: { reason: "2 lines", details: ["a.md:1: x", "b.md:2: y"] },
      },
    });

    expect(line).toBe(
      "gate paths: FAILED, 2 lines\n  a.md:1: x\n  b.md:2: y\n",
    );
  });

  it("names a link and a mention apart", () => {
    const link = formatLinkHit({
      path: "docs/guide.md",
      line: 3,
      target: "internal/a.md",
      kind: LinkHitKinds.LINK,
    });
    const mention = formatLinkHit({
      path: "AGENTS.md",
      line: 9,
      target: ".claude/",
      kind: LinkHitKinds.MENTION,
    });

    expect([link, mention]).toEqual([
      "docs/guide.md:3: link to internal/a.md",
      "AGENTS.md:9: mention of .claude/",
    ]);
  });

  it("prints the plan with its parent, counts, notices and pushes", () => {
    expect(formatPublishPlan(PLAN, true)).toBe(
      [
        "publish 0.1.0 (dry run)",
        "  source   0123456789abcdef0123456789abcdef01234567",
        "  parent   none, first release",
        "  commit   89abcdef0123456789abcdef0123456789abcdef",
        "  tag      v0.1.0",
        "  changes  3120 added, 0 edited, 0 deleted",
        "  public repo Idan91/mergebrief not found",
        "  actions  push commit 89abcdef0123456789abcdef0123456789abcdef to main, push tag v0.1.0, push record public/v0.1.0",
        "",
      ].join("\n"),
    );
  });

  it("says a published release has nothing left to push", () => {
    const plan = { ...PLAN, parent: "aaaa", actions: [], notices: [] };

    expect(formatPublishPlan(plan, false)).toContain("  parent   aaaa\n");
    expect(formatPublishPlan(plan, false)).toContain(
      "  actions  nothing to push, 0.1.0 is published\n",
    );
    expect(formatPublishedAction(PLAN, PublishActions.PUSH_TAG)).toBe(
      "pushed tag v0.1.0\n",
    );
  });
});
