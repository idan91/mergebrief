import { describe, expect, it } from "vitest";
import {
  changesPackageSource,
  flagPackageSourceChanges,
  listRegistryConfigFiles,
  readPackageSourceContext,
  summarizeLockfiles,
} from "../../src/generation/package-sources";
import type { LockfileSummary } from "../../src/generation/shortened/types";
import {
  BriefGenerationSchema,
  ChunkSchema,
  RiskSurfaceAttributes,
  UnattributedFileSchema,
} from "../../src/types";
import {
  makePnpmLockfile,
  makeSides,
  summarizeTexts,
} from "./shortened/helpers";

const CHANGES_PACKAGE_SOURCE = RiskSurfaceAttributes.CHANGES_PACKAGE_SOURCE;
const ADDS_SECRET = RiskSurfaceAttributes.ADDS_SECRET;
const REGISTRY = "resolution: {integrity: sha512-a}";
const MIRROR = "resolution: {tarball: https://mirror.example/x.tgz}";
const UNKNOWN_HOST = "resolution: {type: other}";
const NO_SETTING_FILES: ReadonlySet<string> = new Set();
const NO_CONFIG_CHANGE = {
  registryConfigChanged: false,
  registryConfigFiles: NO_SETTING_FILES,
};
const CONFIG_CHANGED = {
  registryConfigChanged: true,
  registryConfigFiles: NO_SETTING_FILES,
};
const SENTINEL_HOST = "resolution: {tarball: http://registry/evil-1.0.0.tgz}";

function makeNpmLockfile(packages: Record<string, object>): string {
  return JSON.stringify({
    lockfileVersion: 3,
    packages: { "": {}, ...packages },
  });
}

function summarizePnpm(
  before: Record<string, string>,
  after: Record<string, string>,
): LockfileSummary {
  const summary = summarizeTexts(
    "pnpm-lock.yaml",
    makePnpmLockfile(before),
    makePnpmLockfile(after),
  );
  if (summary === undefined) {
    throw new Error("pnpm-lock.yaml is a lockfile");
  }
  return summary;
}

function makeChunk(file: string, riskSurface: string[] = []) {
  return {
    id: file,
    file,
    addedRanges: [{ start: 1, end: 1 }],
    removedRanges: [],
    riskSurface,
  };
}

describe("changesPackageSource", () => {
  it("does not fire on a version bump that keeps the host", () => {
    const summary = summarizePnpm(
      { "foo@1.0.0": REGISTRY },
      { "foo@1.1.0": REGISTRY },
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(false);
  });

  it("fires on a version bump to a new host", () => {
    const summary = summarizePnpm(
      { "foo@1.0.0": REGISTRY },
      { "foo@1.1.0": MIRROR },
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });

  it("fires on a new source at the same version", () => {
    const summary = summarizePnpm(
      { "foo@1.0.0": REGISTRY },
      { "foo@1.0.0": MIRROR },
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });

  it("fires on a version change to a new host that did not pair", () => {
    const summary = summarizePnpm(
      { "foo@1.0.0": REGISTRY, "foo@1.1.0": REGISTRY },
      { "foo@2.0.0": MIRROR },
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });

  it("fires on an added version from a host the base side does not use", () => {
    const summary = summarizePnpm(
      { "foo@1.0.0": REGISTRY },
      { "foo@1.0.0": REGISTRY, "bar@1.0.0": MIRROR },
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });

  it("does not fire on an added version from a host the base already uses", () => {
    const summary = summarizePnpm(
      { "foo@1.0.0": MIRROR },
      { "foo@1.0.0": MIRROR, "bar@1.0.0": MIRROR },
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(false);
  });

  it("fires on an added version whose host is unknown", () => {
    const summary = summarizePnpm(
      { "foo@1.0.0": REGISTRY },
      { "foo@1.0.0": REGISTRY, "bar@1.0.0": UNKNOWN_HOST },
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });

  it.each([
    ["only the public registry", REGISTRY, false],
    ["a host off the public registry", MIRROR, true],
  ])("reads a new lockfile holding %s", (_label, resolution, fires) => {
    const summary = summarizeTexts(
      "pnpm-lock.yaml",
      undefined,
      makePnpmLockfile({ "foo@1.0.0": resolution }),
    );

    expect(summary && changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(
      fires,
    );
  });

  it("fires when one unpaired version moves behind another's host", () => {
    const summary = summarizePnpm(
      { "foo@1.0.0": REGISTRY, "foo@2.0.0": MIRROR },
      { "foo@3.0.0": MIRROR, "foo@4.0.0": REGISTRY, "foo@5.0.0": REGISTRY },
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });

  it("fires on an added npm alias and on an update that changes one", () => {
    const aliased = (name: string | undefined, version: string) =>
      makeNpmLockfile({
        "node_modules/foo": {
          name,
          version,
          resolved: `https://registry.npmjs.org/x/-/x-${version}.tgz`,
        },
      });
    const plain = {
      "node_modules/baz": {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/baz/-/baz-1.0.0.tgz",
      },
    };
    const addFoo = (name: string | undefined) =>
      makeNpmLockfile({
        ...plain,
        "node_modules/foo": {
          name,
          version: "1.0.0",
          resolved: `https://registry.npmjs.org/${name ?? "foo"}/-/${name ?? "foo"}-1.0.0.tgz`,
        },
      });
    const [added, unaliased] = ["bar", undefined].map((name) =>
      summarizeTexts("package-lock.json", makeNpmLockfile(plain), addFoo(name)),
    );
    const retargeted = summarizeTexts(
      "package-lock.json",
      aliased("bar", "1.0.0"),
      aliased("evil", "1.0.1"),
    );

    expect(
      [added, unaliased, retargeted].map(
        (summary) => summary && changesPackageSource(summary, NO_CONFIG_CHANGE),
      ),
    ).toEqual([true, false, true]);
  });

  it.each([
    ["a new lockfile", undefined],
    ["an existing lockfile", makePnpmLockfile({ "foo@1.0.0": REGISTRY })],
  ])(
    "fires on a registry-relative addition to %s when config moves",
    (_label, before) => {
      const after = makePnpmLockfile({
        "foo@1.0.0": REGISTRY,
        "bar@1.0.0": REGISTRY,
      });
      const summary = summarizeTexts("pnpm-lock.yaml", before, after);

      expect(summary && changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(
        false,
      );
      expect(summary && changesPackageSource(summary, CONFIG_CHANGED)).toBe(
        true,
      );
    },
  );

  it("fires on a registry-relative bump when config moves", () => {
    const summary = summarizePnpm(
      { "lodash@4.17.20": REGISTRY },
      { "lodash@4.17.21": REGISTRY },
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(false);
    expect(changesPackageSource(summary, CONFIG_CHANGED)).toBe(true);
  });

  it("fires on a bump from a known private registry when config moves", () => {
    const foo = (version: string) =>
      makeNpmLockfile({
        "node_modules/foo": {
          version,
          resolved: `https://npm.acme.example/foo/-/foo-${version}.tgz`,
        },
      });
    const summary = summarizeTexts(
      "package-lock.json",
      foo("1.0.0"),
      foo("1.0.1"),
    );

    expect(summary && changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(
      false,
    );
    expect(summary && changesPackageSource(summary, CONFIG_CHANGED)).toBe(true);
  });

  it("fires on an npm public registry addition when config moves", () => {
    const lodash = {
      "node_modules/lodash": {
        version: "4.17.21",
        resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
      },
    };
    const leftPad = {
      "node_modules/left-pad": {
        version: "1.3.0",
        resolved: "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
      },
    };
    const summary = summarizeTexts(
      "package-lock.json",
      makeNpmLockfile(lodash),
      makeNpmLockfile({ ...lodash, ...leftPad }),
    );

    expect(summary && changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(
      false,
    );
    expect(summary && changesPackageSource(summary, CONFIG_CHANGED)).toBe(true);
  });

  it.each([
    ["a new lockfile", undefined],
    ["an existing lockfile", makePnpmLockfile({ "foo@1.0.0": REGISTRY })],
  ])(
    "fires on an added url host spelled like the registry in %s",
    (_label, before) => {
      const after = makePnpmLockfile({
        "foo@1.0.0": REGISTRY,
        "bar@1.0.0": SENTINEL_HOST,
      });
      const summary = summarizeTexts("pnpm-lock.yaml", before, after);

      expect(summary && changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(
        true,
      );
    },
  );

  it("does not fire on an added package or another ecosystem", () => {
    const added = summarizePnpm(
      { "foo@1.0.0": REGISTRY },
      { "foo@1.0.0": REGISTRY, "bar@1.0.0": REGISTRY },
    );
    const cargo = summarizeTexts("Cargo.lock", "a", "b");

    expect(
      [added, cargo].map(
        (summary) => summary && changesPackageSource(summary, NO_CONFIG_CHANGE),
      ),
    ).toEqual([false, false]);
  });

  it.each([
    ["unavailable at base", undefined, "packages: {}"],
    ["unparseable at head", "packages: {}", "packages: ["],
  ])("fires when a side is %s", (_label, before, after) => {
    const sides = makeSides(before, after);
    if (before === undefined) {
      sides.before = { kind: "unavailable" };
    }
    const [summary] = summarizeLockfiles(
      ["pnpm-lock.yaml"],
      new Map([["pnpm-lock.yaml", sides]]),
    ).values();

    expect(summary && changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(
      true,
    );
  });
});

function makeNpmTarball(name: string, version: string, url: string) {
  return { [`node_modules/${name}`]: { version, resolved: url } };
}

function summarizeNpm(before: object, after: object): LockfileSummary {
  const summary = summarizeTexts(
    "package-lock.json",
    makeNpmLockfile({ ...before }),
    makeNpmLockfile({ ...after }),
  );
  if (summary === undefined) {
    throw new Error("package-lock.json is a lockfile");
  }
  return summary;
}

describe("changesPackageSource by fetch identity", () => {
  it("fires on a registry bump from https to plain http", () => {
    const summary = summarizeNpm(
      makeNpmTarball(
        "foo",
        "1.0.0",
        "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz",
      ),
      makeNpmTarball(
        "foo",
        "1.0.1",
        "http://registry.npmjs.org/foo/-/foo-1.0.1.tgz",
      ),
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });

  it("fires on an artifact rename on a plain tarball host", () => {
    const summary = summarizeNpm(
      makeNpmTarball(
        "foo",
        "1.0.0",
        "https://cdn.example/artifacts/pkgs/foo-abc123.tgz",
      ),
      makeNpmTarball(
        "foo",
        "1.0.1",
        "https://cdn.example/artifacts/pkgs/evil-def456.tgz",
      ),
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });

  it("fires on a registry tarball bump that changes only its query", () => {
    const summary = summarizeNpm(
      makeNpmTarball(
        "foo",
        "1.0.0",
        "https://reg.example/foo/-/foo-1.0.0.tgz?token=x",
      ),
      makeNpmTarball(
        "foo",
        "1.0.1",
        "https://reg.example/foo/-/foo-1.0.1.tgz?v=evil",
      ),
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });

  it("fires on a bump to a version that climbs out of its tarball path", () => {
    const version = "1.0.1%2F..%2F..%2F..%2Fevil%2F-%2Fevil-6.6.6";
    const summary = summarizeNpm(
      makeNpmTarball(
        "foo",
        "1.0.0",
        "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz",
      ),
      makeNpmTarball(
        "foo",
        version,
        `https://registry.npmjs.org/foo/-/foo-${version}.tgz`,
      ),
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });

  it("does not fire on a registry tarball bump", () => {
    const summary = summarizeNpm(
      makeNpmTarball(
        "foo",
        "1.0.0",
        "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz",
      ),
      makeNpmTarball(
        "foo",
        "1.0.1",
        "https://registry.npmjs.org/foo/-/foo-1.0.1.tgz",
      ),
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(false);
  });

  it("does not fire on an added package from a per-package registry path", () => {
    const base = makeNpmTarball(
      "@acme/a",
      "1.0.0",
      "https://npm.pkg.github.com/download/@acme/a/1.0.0/aaa",
    );
    const added = makeNpmTarball(
      "@acme/b",
      "2.0.0",
      "https://npm.pkg.github.com/download/@acme/b/2.0.0/bbb",
    );
    const summary = summarizeNpm(base, { ...base, ...added });

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(false);
  });

  it("fires on an added package fetching another package's registry tarball", () => {
    const base = makeNpmTarball(
      "a",
      "1.0.0",
      "https://registry.npmjs.org/a/-/a-1.0.0.tgz",
    );
    const added = makeNpmTarball(
      "left-pad-ng",
      "1.0.0",
      "https://registry.npmjs.org/evil/-/evil-6.6.6.tgz",
    );
    const summary = summarizeNpm(base, { ...base, ...added });

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });

  it("fires on an added package from another repository on the same host", () => {
    const base = makeNpmTarball(
      "tooling",
      "1.0.0",
      "git+ssh://git@github.com/acme/tooling.git#aaa",
    );
    const added = makeNpmTarball(
      "x",
      "1.0.0",
      "git+ssh://git@github.com/evil/x.git#bbb",
    );
    const summary = summarizeNpm(base, { ...base, ...added });

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });

  it("does not fire on an added package from a registry under a path", () => {
    const registry = "https://art.corp.example/api/npm/npm-remote";
    const base = makeNpmTarball("a", "1.0.0", `${registry}/a/-/a-1.0.0.tgz`);
    const added = makeNpmTarball(
      "@acme/b",
      "2.0.0",
      `${registry}/@acme/b/-/b-2.0.0.tgz`,
    );
    const summary = summarizeNpm(base, { ...base, ...added });

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(false);
  });

  it.each([
    ["an artifact", "https://cdn.example.com/files/foo.tgz"],
    ["a repository", "https://gitlab.com/acme/tools.git"],
  ])("fires on an added package under %s path the base uses", (_label, url) => {
    const base = makeNpmTarball("foo", "1.0.0", url);
    const added = makeNpmTarball(
      "evil",
      "1.0.0",
      `${url}/evil/-/evil-1.0.0.tgz`,
    );
    const summary = summarizeNpm(base, { ...base, ...added });

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });

  it("fires on an added package from the base's host over another protocol", () => {
    const base = makeNpmTarball("a", "1.0.0", "https://mirror.example/a.tgz");
    const added = makeNpmTarball("b", "1.0.0", "http://mirror.example/b.tgz");
    const summary = summarizeNpm(base, { ...base, ...added });

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });
});

/** A berry lockfile holding the root workspace and each `locator: version`. */
function makeBerryLockfile(entries: Record<string, string>): string {
  const locators = { "root@workspace:.": "0.0.0-use.local", ...entries };
  const body = Object.entries(locators).map(
    ([locator, version]) =>
      `\n"${locator}":\n  version: ${version}\n  resolution: "${locator}"\n  languageName: node\n  linkType: hard\n`,
  );
  return `__metadata:\n  version: 8\n  cacheKey: 10c0\n${body.join("")}`;
}

function summarizeBerry(
  before: Record<string, string>,
  after: Record<string, string>,
): LockfileSummary {
  const summary = summarizeTexts(
    "yarn.lock",
    makeBerryLockfile(before),
    makeBerryLockfile(after),
  );
  if (summary === undefined) {
    throw new Error("yarn.lock is a lockfile");
  }
  return summary;
}

describe("changesPackageSource on berry workspaces", () => {
  const LOCAL = "0.0.0-use.local";

  it("stays quiet when a berry workspace is added or moved", () => {
    const summary = summarizeBerry(
      { "@scope/lib@workspace:packages/lib": LOCAL },
      {
        "@scope/lib@workspace:libs/lib": LOCAL,
        "@scope/new@workspace:packages/new": LOCAL,
      },
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(false);
  });

  it("fires when a registry package becomes a berry workspace", () => {
    const summary = summarizeBerry(
      { "@scope/lib@npm:1.0.0": "1.0.0" },
      { "@scope/lib@workspace:packages/lib": LOCAL },
    );

    expect(changesPackageSource(summary, NO_CONFIG_CHANGE)).toBe(true);
  });
});

describe("summarizeLockfiles", () => {
  it("reads a lockfile with no contents as unavailable", () => {
    const summaries = summarizeLockfiles(["yarn.lock", "src/a.ts"], undefined);

    expect([...summaries]).toEqual([
      ["yarn.lock", { format: "yarn", unread: "unavailable" }],
    ]);
  });
});

describe("registry config changes", () => {
  it.each([
    ['"x\\"y/.npmrc"', '"b/x\\"y/.npmrc"'],
    ['"x\\"y/pnpm-workspace.yaml"', '"b/x\\"y/pnpm-workspace.yaml"'],
  ])("reads a git-quoted change to %s", (_label, file) => {
    const patch = `diff --git "a/x\\"y/f" ${file}\nnew file mode 100644\n--- /dev/null\n+++ ${file}\n@@ -0,0 +1 @@\n+registry=https://evil.example/`;

    expect(listRegistryConfigFiles([{ file, patch }]).size > 0).toBe(true);
  });

  it.each([
    [".NPMRC", "a/.NPMRC", "b/.NPMRC"],
    [
      "pnpm-wor\u212Aspace.yaml",
      "a/pnpm-wor\u212Aspace.yaml",
      "b/pnpm-wor\u212Aspace.yaml",
    ],
    [
      "pnpm-work\u017Fpace.yaml",
      "a/pnpm-work\u017Fpace.yaml",
      "b/pnpm-work\u017Fpace.yaml",
    ],
    [
      '"b/pnpm-wor\\342\\204\\252space.yaml"',
      '"a/pnpm-wor\\342\\204\\252space.yaml"',
      '"b/pnpm-wor\\342\\204\\252space.yaml"',
    ],
  ])("reads the config file name %s in any case", (file, before, after) => {
    const patch = `diff --git ${before} ${after}\n--- ${before}\n+++ ${after}\n@@ -1 +1 @@\n+x`;

    expect(listRegistryConfigFiles([{ file, patch }]).size > 0).toBe(true);
  });

  it.each([
    [".npmrc", "npmrc.bak", true],
    ["pnpm-workspace.yaml", "workspace.yaml.bak", true],
    ["notes.md", "docs/notes.md", false],
  ])("reads a rename of %s to %s", (from, to, changed) => {
    const patch = `diff --git a/${from} b/${to}\nsimilarity index 100%\nrename from ${from}\nrename to ${to}`;

    expect(listRegistryConfigFiles([{ file: to, patch }]).size > 0).toBe(
      changed,
    );
  });

  it.each([
    ["an .npmrc", "apps/web/.npmrc", "+registry=https://evil.example/", true],
    ["a .yarnrc.yml", ".yarnrc.yml", "+enableTelemetry: false", true],
    ["a workspace packages list", "pnpm-workspace.yaml", "+  - apps/*", true],
    [
      "a nested registries value",
      "pnpm-workspace.yaml",
      '+  "@acme": https://evil.example/',
      true,
    ],
    ["a readme", "README.md", "+registry notes", false],
    [
      "a workspace registry line",
      "pnpm-workspace.yaml",
      "+registry: https://evil.example/",
      true,
    ],
  ])("reads a change to %s", (_label, file, line, changed) => {
    const patch = `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n${line}`;

    expect(listRegistryConfigFiles([{ file, patch }]).size > 0).toBe(changed);
  });
});

function makeConfigDiff(file: string, line: string) {
  return {
    file,
    patch: `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1 +1 @@\n${line}`,
  };
}

describe("listRegistryConfigFiles", () => {
  it.each([
    [".npmrc", '+"registry"="https://evil.example/"', true],
    [".yarnrc.yml", "+  acme-legacy:", true],
    ["pnpm-workspace.yaml", "+  - apps/*", true],
    ["README.md", "+registry=https://evil.example/", false],
  ])("reads %s changing %s as %s", (file, line, listed) => {
    const files = listRegistryConfigFiles([makeConfigDiff(file, line)]);

    expect(files.has(file)).toBe(listed);
  });

  it.each([
    [
      "into a config name",
      ".npmrc",
      "diff --git a/packages/legacy/.npmrc b/.npmrc\nsimilarity index 100%\nrename from packages/legacy/.npmrc\nrename to .npmrc",
    ],
    [
      "out of a config name",
      "npmrc.bak",
      "diff --git a/.npmrc b/npmrc.bak\nsimilarity index 100%\nrename from .npmrc\nrename to npmrc.bak",
    ],
  ])("lists a registry config renamed %s", (_label, file, patch) => {
    expect(listRegistryConfigFiles([{ file, patch }])).toEqual(new Set([file]));
  });
});

describe("flagPackageSourceChanges", () => {
  it.each([
    [
      "a git-quoted header",
      "xé/.npmrc",
      '"b/x\\303\\251/.npmrc"',
      'diff --git "a/x\\303\\251/.npmrc" "b/x\\303\\251/.npmrc"\n--- "a/x\\303\\251/.npmrc"\n+++ "b/x\\303\\251/.npmrc"\n@@ -1 +1 @@\n+registry=https://evil.example/',
    ],
    [
      "a git-quoted rename away",
      "xé/npmrc.bak",
      '"b/x\\303\\251/npmrc.bak"',
      'diff --git a/.npmrc "b/x\\303\\251/npmrc.bak"\nsimilarity index 100%\nrename from .npmrc\nrename to "x\\303\\251/npmrc.bak"',
    ],
    [
      "a header renaming it away",
      "npmrc.bak",
      '"b/npmrc.bak"',
      "diff --git a/.npmrc b/npmrc.bak\nsimilarity index 100%\nrename from .npmrc\nrename to npmrc.bak",
    ],
  ])(
    "flags a config chunk keyed apart from %s",
    (_label, chunkPath, file, patch) => {
      const context = readPackageSourceContext([{ file, patch }]);

      const flagged = flagPackageSourceChanges(
        [makeChunk(chunkPath)],
        [],
        new Map(),
        context,
      );

      expect(flagged.chunks[0]?.riskSurface).toEqual([CHANGES_PACKAGE_SOURCE]);
    },
  );

  it("flags a registry config change with no lockfile change", () => {
    const context = readPackageSourceContext([
      makeConfigDiff(".npmrc", "+registry=https://evil.example/"),
      makeConfigDiff("src/a.ts", "+registry"),
    ]);

    const flagged = flagPackageSourceChanges(
      [makeChunk(".npmrc"), makeChunk("src/a.ts")],
      [],
      new Map(),
      context,
    );

    expect(flagged.chunks.map((chunk) => chunk.riskSurface)).toEqual([
      [CHANGES_PACKAGE_SOURCE],
      [],
    ]);
  });

  it("flags only the lockfiles whose summary fires the rule", () => {
    const summaries = new Map([
      [
        "pnpm-lock.yaml",
        summarizePnpm({ "a@1.0.0": REGISTRY }, { "a@1.0.0": MIRROR }),
      ],
      [
        "apps/web/pnpm-lock.yaml",
        summarizePnpm({ "a@1.0.0": REGISTRY }, { "a@1.1.0": REGISTRY }),
      ],
    ]);
    const flagged = flagPackageSourceChanges(
      [
        makeChunk("pnpm-lock.yaml"),
        makeChunk("apps/web/pnpm-lock.yaml", [
          "hot-path",
          CHANGES_PACKAGE_SOURCE,
        ]),
        makeChunk("package-lock.json"),
        makeChunk("src/index.ts", [CHANGES_PACKAGE_SOURCE]),
        makeChunk("Cargo.lock"),
      ],
      [],
      summaries,
      NO_CONFIG_CHANGE,
    );

    expect(flagged.chunks.map((chunk) => chunk.riskSurface)).toEqual([
      [CHANGES_PACKAGE_SOURCE],
      ["hot-path"],
      [CHANGES_PACKAGE_SOURCE],
      [],
      [],
    ]);
  });

  it.each([
    "Package-Lock.json",
    "apps/web/PNPM-LOCK.YAML",
    "Yarn.lock",
    "pac\u212Aage-lock.json",
    "package-lock.j\u017Fon",
    '"a/pac\\342\\204\\252age-lock.json" "b/pac\\342\\204\\252age-lock.json"',
  ])("flags %s, a lockfile name in another case, as unread", (file) => {
    const lockfile = makeNpmLockfile({});

    const flagged = flagPackageSourceChanges(
      [makeChunk(file)],
      [],
      new Map(),
      NO_CONFIG_CHANGE,
    );

    expect(summarizeTexts(file, lockfile, lockfile)).toBeUndefined();
    expect(flagged.chunks[0]?.riskSurface).toEqual([CHANGES_PACKAGE_SOURCE]);
  });

  it("flags a lockfile under a git-quoted path", () => {
    const flagged = flagPackageSourceChanges(
      [makeChunk('"a/x\\"y/pnpm-lock.yaml" "b/x\\"y/pnpm-lock.yaml"')],
      [],
      new Map(),
      NO_CONFIG_CHANGE,
    );

    expect(flagged.chunks[0]?.riskSurface).toEqual([CHANGES_PACKAGE_SOURCE]);
  });

  it("flags an unattributed lockfile and keeps its secret flag", () => {
    const flagged = flagPackageSourceChanges(
      [],
      [
        {
          file: "pnpm-lock.yaml",
          addedRanges: [{ start: 3, end: 3 }],
          removedRanges: [],
          riskSurface: [ADDS_SECRET],
        },
        {
          file: "src/a.ts",
          addedRanges: [{ start: 1, end: 1 }],
          removedRanges: [],
        },
      ],
      new Map(),
      NO_CONFIG_CHANGE,
    );

    expect(flagged.unattributed.map((file) => file.riskSurface)).toEqual([
      [ADDS_SECRET, CHANGES_PACKAGE_SOURCE],
      undefined,
    ]);
  });
});

describe("the changes-package-source vocabulary", () => {
  it("is not an attribute the model may emit", () => {
    const parsed =
      BriefGenerationSchema.shape.chunks.element.shape.riskSurface.safeParse([
        CHANGES_PACKAGE_SOURCE,
      ]);

    expect(parsed.success).toBe(false);
  });

  it("is an attribute a stored chunk and remainder file may carry", () => {
    const chunk = ChunkSchema.shape.riskSurface.safeParse([
      CHANGES_PACKAGE_SOURCE,
    ]);
    const remainder = UnattributedFileSchema.shape.riskSurface.safeParse([
      CHANGES_PACKAGE_SOURCE,
    ]);

    expect([chunk.success, remainder.success]).toEqual([true, true]);
  });
});
