import { describe, expect, it } from "vitest";
import { summarizeTexts } from "../helpers";

/** A v9 lockfile whose every package has its snapshot, as pnpm writes it. */
function makeLockfile(packages: Record<string, string>): string {
  const keys = Object.keys(packages);
  return [
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  .:",
    "    dependencies:",
    "      react:",
    "        specifier: ^18.2.0",
    "        version: 18.2.0",
    "",
    "packages:",
    "",
    ...keys.map((key) => `  ${key}:\n    ${packages[key]}\n`),
    "snapshots:",
    "",
    ...keys.map((key) => `  ${key}: {}\n`),
  ].join("\n");
}

const BEFORE = makeLockfile({
  "'@scope/gone@2.0.0'": "resolution: {integrity: sha512-gone}",
  "lodash@4.17.21": "resolution: {integrity: sha512-lodash-old}",
  "react@18.2.0": "resolution: {integrity: sha512-react-old}",
});

const AFTER = makeLockfile({
  "left-pad@1.3.0": "resolution: {integrity: sha512-left-pad}",
  "lodash@4.17.21": "resolution: {integrity: sha512-lodash-new}",
  "react@18.3.1": "resolution: {integrity: sha512-react-new}",
});

const SHADOW = makeLockfile({
  "'@scope/gone@2.0.0'": "resolution: {integrity: sha512-gone}",
  "lodash@4.17.21": "resolution: {integrity: sha512-lodash-old}",
  "lodash@https://mirror.example/lodash-4.17.21.tgz":
    "resolution: {tarball: https://mirror.example/lodash-4.17.21.tgz}\n    version: 4.17.21",
  "react@18.2.0": "resolution: {integrity: sha512-react-old}",
});

function summarize(before: string, after: string) {
  return summarizeTexts("pnpm-lock.yaml", before, after);
}

/** pnpm 10's first document: the lockfile of pnpm's own install. */
const ENV_DOCUMENT = [
  "---",
  "lockfileVersion: '9.0'",
  "",
  "importers:",
  "",
  "  .:",
  "    packageManagerDependencies:",
  "      pnpm:",
  "        specifier: 10.0.0",
  "        version: 10.0.0",
  "",
  "packages:",
  "",
  "  pnpm@10.0.0:",
  "    resolution: {integrity: sha512-pnpm}",
  "",
  "snapshots:",
  "",
  "  pnpm@10.0.0: {}",
  "",
  "---",
  "",
].join("\n");

describe("pnpm lockfile summary", () => {
  it("reads both documents pnpm 10 writes", () => {
    const after = `${ENV_DOCUMENT}${BEFORE}`.replace(
      "  lodash@4.17.21:\n    resolution: {integrity: sha512-lodash-old}",
      "  lodash@4.17.21:\n    resolution: {integrity: sha512-lodash-new}",
    );

    expect(summarize(`${ENV_DOCUMENT}${BEFORE}`, after)).toMatchObject({
      format: "pnpm",
      changes: { added: [], sourceChanged: [{ name: "lodash" }] },
      baseHosts: ["registry"],
    });
  });

  it("reads a change in pnpm 10's own document", () => {
    const after = `${ENV_DOCUMENT.replace("sha512-pnpm", "sha512-other")}${BEFORE}`;

    expect(summarize(`${ENV_DOCUMENT}${BEFORE}`, after)).toMatchObject({
      changes: { sourceChanged: [{ name: "pnpm", version: "10.0.0" }] },
    });
  });

  it("lists added, removed, updated and same-version source changes", () => {
    expect(summarize(BEFORE, AFTER)).toEqual({
      format: "pnpm",
      changes: {
        added: [{ name: "left-pad", version: "1.3.0", hosts: ["registry"] }],
        removed: [
          { name: "@scope/gone", version: "2.0.0", hosts: ["registry"] },
        ],
        updated: [
          {
            name: "react",
            from: "18.2.0",
            to: "18.3.1",
            fromHosts: ["registry"],
            toHosts: ["registry"],
          },
        ],
        sourceChanged: [
          {
            name: "lodash",
            version: "4.17.21",
            fromHosts: ["registry"],
            toHosts: ["registry"],
          },
        ],
      },
      baseHosts: ["registry"],
    });
  });

  it("reads a second source for a kept version as a source change", () => {
    expect(summarize(BEFORE, SHADOW)).toMatchObject({
      changes: {
        added: [],
        sourceChanged: [{ name: "lodash", version: "4.17.21" }],
      },
    });
  });

  it("names a tarball's host and the registry for an integrity", () => {
    const before = makeLockfile({
      "lodash@4.17.20": "resolution: {integrity: sha512-x}",
    });
    const after = makeLockfile({
      "lodash@https://mirror.example/lodash-4.17.21.tgz":
        "resolution: {tarball: https://mirror.example/lodash-4.17.21.tgz}\n    version: 4.17.21",
    });

    expect(summarize(before, after)).toMatchObject({
      changes: {
        updated: [
          {
            name: "lodash",
            fromHosts: ["registry"],
            toHosts: ["https://mirror.example/lodash-{version}.tgz"],
          },
        ],
      },
    });
  });

  it("reads an owner move on one host as another fetch identity", () => {
    const tarball = (owner: string, version: string) =>
      `lockfileVersion: '9.0'\npackages:\n  foo@${version}:\n    resolution: {tarball: https://codeload.github.com/${owner}/foo/tar.gz/${version}}\nsnapshots:\n  foo@${version}: {}\n`;
    const summary = summarize(
      tarball("owner1", "1.0.0"),
      tarball("owner2", "1.1.0"),
    );

    expect(summary).toMatchObject({
      changes: {
        updated: [
          {
            fromHosts: [
              "https://codeload.github.com/owner1/foo/tar.gz/{version}",
            ],
            toHosts: [
              "https://codeload.github.com/owner2/foo/tar.gz/{version}",
            ],
          },
        ],
      },
    });
  });

  it.each([
    [
      "a binary url",
      "{type: binary, archive: tarball, url: https://mirror.example/x.tgz, integrity: sha512-x}",
      ["https://mirror.example/x.tgz"],
    ],
    [
      "a git repo, not its tarball",
      "{type: git, repo: https://mirror.example/x.git, commit: abc, tarball: https://registry.npmjs.org/x.tgz}",
      undefined,
    ],
    [
      "a git repo",
      "{type: git, repo: https://mirror.example/x.git, commit: abc}",
      ["https://mirror.example/x.git"],
    ],
    [
      "an unknown resolution type",
      "{type: variations, integrity: sha512-x}",
      undefined,
    ],
    [
      "an integrity with an extra field",
      "{integrity: sha512-x, url: https://mirror.example/x.tgz}",
      undefined,
    ],
  ])("reads the fetch host of %s", (_label, resolution, hosts) => {
    const before =
      "lockfileVersion: '9.0'\npackages:\n  foo@1.0.0:\n    resolution: {integrity: sha512-a}\n";
    const after = `lockfileVersion: '9.0'\npackages:\n  foo@2.0.0:\n    resolution: ${resolution}\n`;
    const summary = summarize(before, after);

    expect(summary).toMatchObject({ changes: { updated: [{ name: "foo" }] } });
    const [update] =
      summary !== undefined && "changes" in summary
        ? summary.changes.updated
        : [];
    expect(update?.toHosts).toEqual(hosts);
  });

  it("reads a packages key no snapshot installs as ambiguous", () => {
    const base =
      "lockfileVersion: '9.0'\npackages:\n  foo@1.0.0:\n    resolution: {integrity: sha512-a}\nsnapshots:\n  foo@1.0.0: {}\n";
    const unsnapshotted = base
      .replace("snapshots:\n  foo@1.0.0: {}\n", "snapshots:\n  bar@1.0.0: {}\n")
      .replace(
        "packages:\n",
        "packages:\n  bar@1.0.0:\n    resolution: {integrity: sha512-b}\n",
      );

    expect(summarize(base, unsnapshotted)).toEqual({
      format: "pnpm",
      unread: "ambiguous",
    });
  });

  it("reads snapshots in a lockfile before v9 as ambiguous", () => {
    const base =
      "lockfileVersion: '6.0'\npackages:\n  /foo@1.0.0:\n    resolution: {integrity: sha512-A}\n";
    const decoy = [
      "lockfileVersion: '6.0'",
      "packages:",
      "  /foo@1.0.0:",
      "    resolution: {tarball: https://evil.example/foo.tgz}",
      "  foo@1.0.0:",
      "    resolution: {integrity: sha512-A}",
      "snapshots:",
      "  foo@1.0.0: {}",
      "",
    ].join("\n");

    expect(summarize(base, decoy)).toEqual({
      format: "pnpm",
      unread: "ambiguous",
    });
  });

  it.each([
    ["no packages entry", "snapshots:\n  foo@1.0.0: {}\n  foo@1.0.1: {}\n"],
    [
      "its own resolution",
      "snapshots:\n  foo@1.0.0:\n    resolution: {tarball: https://mirror.example/x.tgz}\n",
    ],
  ])("reads a snapshot with %s as ambiguous", (_label, snapshots) => {
    const base =
      "lockfileVersion: '9.0'\npackages:\n  foo@1.0.0:\n    resolution: {integrity: sha512-a}\nsnapshots:\n  foo@1.0.0: {}\n";
    const after = base.replace("snapshots:\n  foo@1.0.0: {}\n", snapshots);

    expect(summarize(base, after)).toEqual({
      format: "pnpm",
      unread: "ambiguous",
    });
  });

  it.each(["foo@1.0.0(x", "foo@1.0.0(a)b(c@1)"])(
    "reads snapshot %s, not a trailing peer suffix, as ambiguous",
    (snapshotKey) => {
      const base =
        "lockfileVersion: '9.0'\npackages:\n  foo@1.0.0:\n    resolution: {integrity: sha512-a}\nsnapshots:\n  foo@1.0.0: {}\n";
      const after = [
        "lockfileVersion: '9.0'",
        "packages:",
        "  foo@1.0.0:",
        "    resolution: {integrity: sha512-a}",
        `  '${snapshotKey}':`,
        "    resolution: {tarball: https://evil.example/foo.tgz}",
        "snapshots:",
        `  '${snapshotKey}': {}`,
        "",
      ].join("\n");

      expect(summarize(base, after)).toEqual({
        format: "pnpm",
        unread: "ambiguous",
      });
    },
  );

  it("reads a v6 key with text after a peer group as unparseable", () => {
    const base =
      "lockfileVersion: '6.0'\npackages:\n  /foo@1.0.0:\n    resolution: {integrity: sha512-a}\n";
    const after = base.replace("/foo@1.0.0:", "/foo@1.0.0(a)b:");

    expect(summarize(base, after)).toEqual({
      format: "pnpm",
      unread: "unparseable",
    });
  });

  it("leaves a repo host unknown when the url could parse two ways", () => {
    const before =
      "lockfileVersion: '9.0'\npackages:\n  foo@1.0.0:\n    resolution: {type: git, repo: https://github.com/acme/foo.git, commit: a}\n";
    const after =
      "lockfileVersion: '9.0'\npackages:\n  foo@1.0.1:\n    resolution: {type: git, repo: 'https://github.com\\@mirror.example/acme/foo.git', commit: b}\n";
    const summary = summarize(before, after);
    const [update] =
      summary !== undefined && "changes" in summary
        ? summary.changes.updated
        : [];

    expect(update?.fromHosts).toEqual(["https://github.com/acme/foo.git"]);
    expect(update?.toHosts).toBeUndefined();
  });

  it("reads lockfile v6 and v5 keys", () => {
    const v6 =
      "lockfileVersion: '6.0'\npackages:\n  /zod@3.22.0(peer@1.0.0):\n    resolution: {integrity: sha512-a}\n";
    const v5 =
      "lockfileVersion: 5.4\npackages:\n  /zod/3.23.8:\n    resolution: {integrity: sha512-b}\n";

    expect(summarize(v6, v5)).toMatchObject({
      changes: { updated: [{ name: "zod", from: "3.22.0", to: "3.23.8" }] },
    });
  });

  it("reads a v5 peer-only re-resolution as no change", () => {
    const v5 = (key: string) =>
      `lockfileVersion: 5.4\npackages:\n  ${key}:\n    resolution: {integrity: sha512-a}\n`;

    expect(
      summarize(v5("/foo/1.0.0_react@17.0.2"), v5("/foo/1.0.0_react@18.2.0")),
    ).toMatchObject({
      changes: { added: [], removed: [], updated: [], sourceChanged: [] },
    });
  });

  it("reads a v5 version past its scoped or hashed peer suffix", () => {
    const before =
      "lockfileVersion: 5.4\npackages:\n  /@emotion/react/11.10.5_@babel+core@7.20.0+react@18.2.0:\n    resolution: {integrity: sha512-a}\n  /x/1.0.0_ihtk2dwsvebstxcppqpyt3ayy4:\n    resolution: {integrity: sha512-b}\n";
    const after = before
      .replace("11.10.5_", "11.11.0_")
      .replace("/x/1.0.0_", "/x/1.0.1_");

    expect(summarize(before, after)).toMatchObject({
      changes: {
        updated: [
          { name: "@emotion/react", from: "11.10.5", to: "11.11.0" },
          { name: "x", from: "1.0.0", to: "1.0.1" },
        ],
      },
    });
  });

  it("reads a v6 git or file key by the name its record holds", () => {
    const pinned = (sha: string) =>
      [
        "lockfileVersion: '6.0'",
        "packages:",
        `  github.com/acme/foo/${sha}:`,
        `    resolution: {tarball: https://codeload.github.com/acme/foo/tar.gz/${sha}}`,
        "    name: foo",
        "    version: 1.0.0",
        "  file:packages/bar:",
        "    resolution: {directory: packages/bar, type: directory}",
        "    name: bar",
        "    version: 0.0.1",
        "",
      ].join("\n");
    const repository = "https://codeload.github.com/acme/foo/tar.gz/";

    expect(summarize(pinned("abc123"), pinned("def456"))).toEqual({
      format: "pnpm",
      changes: {
        added: [],
        removed: [],
        updated: [],
        sourceChanged: [
          {
            name: "foo",
            version: "1.0.0",
            fromHosts: [repository],
            toHosts: [repository],
          },
        ],
      },
      baseHosts: expect.arrayContaining([repository]),
    });
  });

  it("reads a v6 nameless key resolved by integrity alone as unparseable", () => {
    const base =
      "lockfileVersion: '6.0'\npackages:\n  /foo/1.0.0:\n    resolution: {integrity: sha512-foo}\n";
    const swapped =
      "lockfileVersion: '6.0'\npackages:\n  x/bar/1.0.1:\n    resolution: {integrity: sha512-bar}\n    name: foo\n    version: 1.0.1\n";

    expect(summarize(base, swapped)).toEqual({
      format: "pnpm",
      unread: "unparseable",
    });
  });

  it("reads a v9 key naming no package as unparseable", () => {
    const after = makeLockfile({
      "github.com/acme/foo/abc123":
        "resolution: {tarball: https://codeload.github.com/acme/foo/tar.gz/abc123}\n    name: foo\n    version: 1.0.0",
    });

    expect(summarize(BEFORE, after)).toEqual({
      format: "pnpm",
      unread: "unparseable",
    });
  });

  it("reads the same text with CRLF line endings the same way", () => {
    const crlf = AFTER.replaceAll("\n", "\r\n");

    expect(summarize(BEFORE, crlf)).toEqual(summarize(BEFORE, AFTER));
  });

  it.each([
    [
      "a duplicate key",
      BEFORE.replace(
        "snapshots:",
        "  lodash@4.17.21:\n    resolution: {tarball: x}\n\nsnapshots:",
      ),
    ],
    [
      "an anchor and alias",
      BEFORE.replace(
        "{integrity: sha512-gone}",
        "&r {integrity: sha512-gone}",
      ).replace("{integrity: sha512-lodash-old}", "*r"),
    ],
    [
      "a merge key",
      BEFORE.replace(
        "    resolution: {integrity: sha512-lodash-old}",
        "    <<: {name: lodash}\n    resolution: {integrity: sha512-lodash-old}",
      ),
    ],
    [
      "an explicit tag",
      BEFORE.replace(
        "{integrity: sha512-gone}",
        "!!map {integrity: sha512-gone}",
      ),
    ],
  ])("reads a lockfile with %s as ambiguous", (_label, after) => {
    expect(summarize(BEFORE, after)).toEqual({
      format: "pnpm",
      unread: "ambiguous",
    });
  });

  it("reads a record whose name disagrees with its key as ambiguous", () => {
    const after = BEFORE.replace(
      "  lodash@4.17.21:\n    resolution: {integrity: sha512-lodash-old}",
      "  lodash@4.17.21:\n    name: other\n    resolution: {integrity: sha512-evil}",
    );

    expect(summarize(BEFORE, after)).toEqual({
      format: "pnpm",
      unread: "ambiguous",
    });
  });

  it("reads YAML nested past the stack as unparseable", () => {
    const deep = `packages: ${"[".repeat(200_000)}${"]".repeat(200_000)}\n`;

    expect(summarize(BEFORE, deep)).toEqual({
      format: "pnpm",
      unread: "unparseable",
    });
  });

  it("reads text that is not YAML as unparseable", () => {
    expect(summarize(BEFORE, "packages: [unclosed")).toEqual({
      format: "pnpm",
      unread: "unparseable",
    });
  });
});
