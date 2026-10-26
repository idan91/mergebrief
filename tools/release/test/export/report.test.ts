import { describe, expect, it } from "vitest";
import { formatExportReport } from "../../src/logic/export/report";
import { type ExportReport, LinkHitKinds } from "../../src/logic/export/types";

const REPORT: ExportReport = {
  version: "0.1.0-rc.1",
  commit: "0123456789abcdef0123456789abcdef01234567",
  out: "/tmp/tree",
  fileCount: 3120,
  excluded: [
    { prefix: "docs/internal/", count: 52 },
    { prefix: "docs/plans/", count: 0 },
  ],
  linkHits: [],
};

describe("the export report", () => {
  it("prints the source, tree, counts and a clean link check", () => {
    expect(formatExportReport(REPORT)).toBe(
      [
        "export 0.1.0-rc.1 (dry run)",
        "  source   0123456789abcdef0123456789abcdef01234567",
        "  tree     /tmp/tree",
        "  files    3120",
        "  excluded docs/internal/ 52",
        "  excluded docs/plans/ 0",
        "link check: ok",
        "",
      ].join("\n"),
    );
  });

  it("prints one file and line per link-check hit", () => {
    const report: ExportReport = {
      ...REPORT,
      excluded: [],
      linkHits: [
        {
          path: "docs/guide.md",
          line: 3,
          target: "internal/a.md",
          kind: LinkHitKinds.LINK,
        },
        {
          path: "AGENTS.md",
          line: 9,
          target: ".claude/",
          kind: LinkHitKinds.MENTION,
        },
      ],
    };

    expect(formatExportReport(report)).toContain(
      [
        "link check: 2 hits",
        "  docs/guide.md:3: link to internal/a.md",
        "  AGENTS.md:9: mention of .claude/",
      ].join("\n"),
    );
  });
});
