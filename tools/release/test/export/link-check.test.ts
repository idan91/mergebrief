import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkTreeLinks,
  findInternalLinks,
} from "../../src/logic/export/link-check";
import { LinkHitKinds } from "../../src/logic/export/types";
import { makeTempRoot, writeTree } from "../helpers";

const made: string[] = [];

afterEach(() => {
  for (const root of made.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("finding internal links in one markdown file", () => {
  it("reports a link into an excluded dir with its line", () => {
    const text = "# Guide\n\nSee [the ADR](internal/adr/0001.md#why).\n";

    const hits = findInternalLinks("docs/guide.md", text);

    expect(hits).toEqual([
      {
        path: "docs/guide.md",
        line: 3,
        target: "internal/adr/0001.md#why",
        kind: LinkHitKinds.LINK,
      },
    ]);
  });

  it("resolves parent, root-relative and reference-style links", () => {
    const text = [
      "[up](../../docs/plans/x.md)",
      "[root](/.claude/settings.json)",
      "[ref]: ../../docs/internal/",
    ].join("\n");

    const hits = findInternalLinks("apps/api/README.md", text);

    expect(hits.map((hit) => [hit.line, hit.target])).toEqual([
      [1, "../../docs/plans/x.md"],
      [2, "/.claude/settings.json"],
      [3, "../../docs/internal/"],
    ]);
  });

  it("passes external URLs, anchors and links to shipped paths", () => {
    const text = [
      "[web](https://example.com/docs/internal/x)",
      "[mail](mailto:a@b.c)",
      "[here](#docs-internal)",
      "[ops](self-host/operations.md)",
      "[escape](../../outside.md)",
      "[odd](bad%zz.md)",
    ].join("\n");

    expect(findInternalLinks("docs/index.md", text)).toEqual([]);
  });

  it("reports a literal mention of an excluded prefix", () => {
    const text = "The record lives under `docs/internal/adr/`.\n";

    const hits = findInternalLinks("packages/x/AGENTS.md", text);

    expect(hits).toEqual([
      {
        path: "packages/x/AGENTS.md",
        line: 1,
        target: "docs/internal/",
        kind: LinkHitKinds.MENTION,
      },
    ]);
  });

  it("reports one hit for a link whose text also names the prefix", () => {
    const text = "[docs/internal/](docs/internal/README.md)\n";

    const hits = findInternalLinks("README.md", text);

    expect(hits.map((hit) => hit.kind)).toEqual([LinkHitKinds.LINK]);
  });

  it("ignores a home-dir path that only contains a prefix", () => {
    const text = "Sessions land in `~/.claude/projects` on the host.\n";

    expect(findInternalLinks("docs/x.md", text)).toEqual([]);
  });

  it("lets the root rule line name the prefix it excludes", () => {
    const text =
      "- Cite ADR numbers only under `docs/internal/`, which the public release snapshot excludes.\n";

    expect(findInternalLinks("AGENTS.md", text)).toEqual([]);
    expect(findInternalLinks("docs/AGENTS.md", text)).toHaveLength(1);
  });
});

describe("lines that state the exclusion rule", () => {
  it("lets the root ticket-board pointer name its private file", () => {
    const text =
      "A `BRIEF-nnn` reference names a ticket on the maintainers' board; read `docs/internal/ticket-board.md`, which the public release snapshot excludes, for the board link and status workflow before acting on it.\n";

    expect(findInternalLinks("AGENTS.md", text)).toEqual([]);
  });

  it("passes the eval README naming the private case dirs it keeps", () => {
    const text = [
      "internal-doc text, private process) lives in `private-cases/<id>/` or",
      "`private-pair-cases/<id>/`, same shape as its public peer. These dirs",
      "`test/pipeline-goldens-private.test.ts` and its snapshot. The eval CLI",
    ].join("\n");

    expect(findInternalLinks("tools/categorizer/eval/README.md", text)).toEqual(
      [],
    );
  });

  it("still reports the repo path of a private case dir in prose", () => {
    const text = "See `tools/categorizer/eval/private-cases/x/`.\n";

    expect(findInternalLinks("docs/x.md", text)).toHaveLength(1);
  });
});

describe("checking the shipped markdown in a tree", () => {
  it("scans the listed markdown files and skips symlinks", () => {
    const root = makeTempRoot();
    made.push(root);
    writeTree(root, {
      "AGENTS.md": "see `.serena/project.yml`\n",
      "notes.txt": "see docs/internal/\n",
      "docs/guide.md": "[x](internal/a.md)\n",
    });
    symlinkSync("AGENTS.md", join(root, "CLAUDE.md"));
    mkdirSync(join(root, "empty"));

    const hits = checkTreeLinks(root, [
      "AGENTS.md",
      "CLAUDE.md",
      "docs/guide.md",
      "notes.txt",
    ]);

    expect(hits.map((hit) => `${hit.path}:${hit.line}`)).toEqual([
      "AGENTS.md:1",
      "docs/guide.md:1",
    ]);
  });
});
