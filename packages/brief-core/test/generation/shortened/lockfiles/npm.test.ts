import { describe, expect, it } from "vitest";
import { summarizeTexts } from "../helpers";

function makeLockfile(packages: Record<string, object>): string {
  const body = {
    name: "app",
    lockfileVersion: 3,
    packages: { "": {}, ...packages },
  };
  return JSON.stringify(body, null, 2);
}

const BEFORE = makeLockfile({
  "node_modules/@scope/gone": { version: "2.0.0" },
  "node_modules/lodash": {
    version: "4.17.21",
    resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
    integrity: "sha512-lodash",
  },
  "node_modules/react": { version: "18.2.0", integrity: "sha512-react-old" },
});

const AFTER = makeLockfile({
  "apps/web": { version: "0.0.0" },
  "node_modules/left-pad": { version: "1.3.0", integrity: "sha512-left-pad" },
  "node_modules/lodash": {
    version: "4.17.21",
    resolved: "https://mirror.example/lodash-4.17.21.tgz",
    integrity: "sha512-lodash",
  },
  "node_modules/react": { version: "18.3.1", integrity: "sha512-react-new" },
});

function summarize(before: string, after: string) {
  return summarizeTexts("package-lock.json", before, after);
}

describe("npm lockfile summary", () => {
  it("lists added, removed, updated and same-version source changes", () => {
    expect(summarize(BEFORE, AFTER)).toEqual({
      format: "npm",
      changes: {
        added: [{ name: "left-pad", version: "1.3.0" }],
        removed: [{ name: "@scope/gone", version: "2.0.0" }],
        updated: [{ name: "react", from: "18.2.0", to: "18.3.1" }],
        sourceChanged: [
          {
            name: "lodash",
            version: "4.17.21",
            fromHosts: ["registry:https://registry.npmjs.org"],
            toHosts: ["https://mirror.example/lodash-{version}.tgz"],
          },
        ],
      },
      baseHosts: ["registry:https://registry.npmjs.org"],
    });
  });

  it("reads a same version from a new source at a nested path", () => {
    const after = BEFORE.replace(
      '"node_modules/react"',
      '"node_modules/a/node_modules/lodash": { "version": "4.17.21", "integrity": "sha512-other" },\n    "node_modules/react"',
    );

    expect(summarize(BEFORE, after)).toMatchObject({
      changes: { sourceChanged: [{ name: "lodash", version: "4.17.21" }] },
    });
  });

  it("names each version's fetch host on an update", () => {
    const before = makeLockfile({
      "node_modules/a": {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz",
      },
    });
    const after = makeLockfile({
      "node_modules/a": {
        version: "1.0.1",
        resolved: "https://mirror.example/a-1.0.1.tgz",
      },
    });

    expect(summarize(before, after)).toMatchObject({
      changes: {
        updated: [
          {
            name: "a",
            fromHosts: ["registry:https://registry.npmjs.org"],
            toHosts: ["https://mirror.example/a-{version}.tgz"],
          },
        ],
      },
    });
  });

  it("reads a source change in the v1 tree of a v2 lockfile", () => {
    const lodash = {
      version: "4.17.21",
      resolved: "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
      integrity: "sha512-lodash",
    };
    const v2 = (dependency: object) =>
      JSON.stringify({
        lockfileVersion: 2,
        packages: { "": {}, "node_modules/lodash": lodash },
        dependencies: { lodash: dependency },
      });
    const moved = { ...lodash, resolved: "https://evil.example/lodash.tgz" };

    expect(summarize(v2(lodash), v2(lodash))).toMatchObject({
      changes: { sourceChanged: [] },
    });
    expect(summarize(v2(lodash), v2(moved))).toMatchObject({
      changes: { sourceChanged: [{ name: "lodash", version: "4.17.21" }] },
    });
  });

  it.each([
    [
      "an installed record without a version",
      AFTER.replace(
        '"node_modules/react"',
        '"node_modules/evil": { "resolved": "https://evil.example/evil.tgz" },\n    "node_modules/react"',
      ),
    ],
    [
      "a v1 record without a version",
      JSON.stringify({
        lockfileVersion: 1,
        dependencies: { evil: { resolved: "https://evil.example/evil.tgz" } },
      }),
    ],
  ])("reads a lockfile with %s as ambiguous", (_label, after) => {
    expect(summarize(BEFORE, after)).toEqual({
      format: "npm",
      unread: "ambiguous",
    });
  });

  it.each([
    ["adding", undefined, "packages/new-lib"],
    ["moving", "packages/new-lib", "libs/new-lib"],
  ])("reads %s a v2 workspace as no package change", (_label, from, to) => {
    const v2 = (folder: string | undefined) => {
      const body: Record<string, Record<string, object>> = {
        packages: { "": {} },
        dependencies: {},
      };
      if (folder !== undefined) {
        body["packages"] = {
          "": {},
          [folder]: { version: "1.0.0" },
          "node_modules/new-lib": { resolved: folder, link: true },
        };
        body["dependencies"] = { "new-lib": { version: `file:${folder}` } };
      }
      return JSON.stringify({ lockfileVersion: 2, ...body });
    };

    expect(summarize(v2(from), v2(to))).toMatchObject({
      changes: { sourceChanged: [], updated: [], added: [], removed: [] },
    });
  });

  it("reads a v1 URL version under a v2 link as the source npm 6 fetches", () => {
    const linkedTo = (version: string) =>
      JSON.stringify({
        lockfileVersion: 2,
        packages: {
          "": {},
          "packages/lib": { version: "1.0.0" },
          "node_modules/lib": { resolved: "packages/lib", link: true },
        },
        dependencies: { lib: { version } },
      });

    expect(
      summarize(
        linkedTo("file:packages/lib"),
        linkedTo("https://evil.example/lib.tgz"),
      ),
    ).toMatchObject({ changes: { added: [{ name: "lib" }] } });
  });

  it.each([
    ["a resolved", { resolved: "https://evil.example/lib.tgz" }],
    ["a from", { from: "https://evil.example/lib.tgz" }],
  ])("reads a v2 workspace link carrying %s as a package", (_label, field) => {
    const linked = (record: object) =>
      JSON.stringify({
        lockfileVersion: 2,
        packages: {
          "": {},
          "packages/lib": { version: "1.0.0" },
          "node_modules/lib": { resolved: "packages/lib", link: true },
        },
        dependencies: { lib: { version: "file:packages/lib", ...record } },
      });
    const empty = JSON.stringify({ lockfileVersion: 2, packages: { "": {} } });

    expect(summarize(empty, linked(field))).toMatchObject({
      changes: { added: [{ name: "lib" }] },
    });
  });

  it.each([
    ["a folder outside the repo", "../outside/lib", "../outside/lib"],
    ["a tarball", "vendor/lib.tgz", "vendor/lib.tgz"],
    ["a tarball npm 6 reads by a loose suffix", "lib.tar_gz", "lib.tar_gz"],
    ["a home folder", "~/lib", "~/lib"],
    ["an authority", "//evil.example/lib", "//evil.example/lib"],
    ["an absolute path", "/srv/lib", "/srv/lib"],
    ["another folder than the link's", "packages/lib", "packages/other"],
  ])("reads a v2 link to %s as a package", (_label, target, spec) => {
    const linked = JSON.stringify({
      lockfileVersion: 2,
      packages: {
        "": {},
        [target]: { version: "1.0.0" },
        "node_modules/lib": { resolved: target, link: true },
      },
      dependencies: { lib: { version: `file:${spec}` } },
    });
    const empty = JSON.stringify({ lockfileVersion: 2, packages: { "": {} } });

    expect(summarize(empty, linked)).toMatchObject({
      changes: { added: [{ name: "lib" }] },
    });
  });

  it("reads a v2 link whose folder has no packages record as a package", () => {
    const linked = JSON.stringify({
      lockfileVersion: 2,
      packages: {
        "": {},
        "node_modules/lib": { resolved: "packages/lib", link: true },
      },
      dependencies: { lib: { version: "file:packages/lib" } },
    });
    const empty = JSON.stringify({ lockfileVersion: 2, packages: { "": {} } });

    expect(summarize(empty, linked)).toMatchObject({
      changes: { added: [{ name: "lib" }] },
    });
  });

  it("reads a v1 key that is no package name as unparseable", () => {
    const linked = JSON.stringify({
      lockfileVersion: 2,
      packages: {
        "": {},
        "packages/lib": { version: "1.0.0" },
        "node_modules/../lib": { resolved: "packages/lib", link: true },
      },
      dependencies: { "../lib": { version: "file:packages/lib" } },
    });

    expect(summarize(BEFORE, linked)).toEqual({
      format: "npm",
      unread: "unparseable",
    });
  });

  it("reads the dependencies nested under a v2 workspace link", () => {
    const linked = JSON.stringify({
      lockfileVersion: 2,
      packages: {
        "": {},
        "packages/lib": { version: "1.0.0" },
        "node_modules/lib": { resolved: "packages/lib", link: true },
      },
      dependencies: {
        lib: {
          version: "file:packages/lib",
          dependencies: {
            evil: {
              version: "1.0.0",
              resolved: "https://evil.example/evil-1.0.0.tgz",
            },
          },
        },
      },
    });
    const empty = JSON.stringify({ lockfileVersion: 2, packages: { "": {} } });

    expect(summarize(empty, linked)).toMatchObject({
      changes: { added: [{ name: "evil", version: "1.0.0" }] },
    });
  });

  it("skips a linked record without a version", () => {
    const linked = AFTER.replace(
      '"node_modules/react"',
      '"node_modules/local": { "resolved": "packages/local", "link": true },\n    "node_modules/react"',
    );

    expect(summarize(BEFORE, linked)).toEqual(summarize(BEFORE, AFTER));
  });

  it("keys an alias by its install folder and names the package it aliases", () => {
    const aliased = (target: string) =>
      makeLockfile({
        "node_modules/string-width-cjs": {
          name: target,
          version: "4.2.3",
          resolved: "https://registry.npmjs.org/x/-/x-4.2.3.tgz",
          integrity: "sha512-x",
        },
      });
    const summary = summarizeTexts(
      "package-lock.json",
      aliased("string-width"),
      aliased("evil-width"),
    );

    expect(summary).toMatchObject({
      changes: {
        sourceChanged: [
          {
            name: "string-width-cjs",
            version: "4.2.3",
            fromAliasOf: "string-width",
            toAliasOf: "evil-width",
          },
        ],
      },
    });
  });

  it("reads a URL host spelled like the registry sentinel as unknown", () => {
    const summary = summarizeTexts(
      "package-lock.json",
      makeLockfile({}),
      makeLockfile({
        "node_modules/evil": {
          version: "1.0.0",
          resolved: "http://registry/evil-1.0.0.tgz",
        },
      }),
    );

    expect(summary).toMatchObject({
      changes: { added: [{ name: "evil", version: "1.0.0" }] },
    });
    expect(JSON.stringify(summary)).not.toContain('"hosts"');
  });

  it.each([
    [
      "its own registry tarball",
      "lodash",
      "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
      ["registry:https://registry.npmjs.org"],
    ],
    [
      "its own scoped registry tarball",
      "@s/pkg",
      "https://registry.npmjs.org/@s/pkg/-/pkg-4.17.21.tgz",
      ["registry:https://registry.npmjs.org"],
    ],
    [
      "another package's registry tarball",
      "lodash",
      "https://registry.npmjs.org/evil/-/evil-4.17.21.tgz",
      ["https://registry.npmjs.org/evil/-/evil-{version}.tgz"],
    ],
  ])("reads the fetch identity of %s", (_label, name, resolved, hosts) => {
    const lockfile = (version: string, url: string) =>
      makeLockfile({ [`node_modules/${name}`]: { version, resolved: url } });
    const summary = summarizeTexts(
      "package-lock.json",
      lockfile("4.17.20", resolved.replaceAll("4.17.21", "4.17.20")),
      lockfile("4.17.21", resolved),
    );

    expect(summary).toMatchObject({
      changes: { updated: [{ name, toHosts: hosts }] },
    });
  });

  it("reads a bundled record from its bundling parent's host", () => {
    const after = makeLockfile({
      "node_modules/host-pkg": {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/host-pkg/-/host-pkg-1.0.0.tgz",
        bundleDependencies: ["inner"],
      },
      "node_modules/host-pkg/node_modules/inner": {
        version: "2.0.0",
        inBundle: true,
      },
    });

    expect(summarize(makeLockfile({}), after)).toMatchObject({
      changes: {
        added: [
          { name: "host-pkg", hosts: ["registry:https://registry.npmjs.org"] },
          { name: "inner", hosts: ["registry:https://registry.npmjs.org"] },
        ],
      },
    });
  });

  it("reads a bundled record naming its own resolved by that host", () => {
    const after = makeLockfile({
      "node_modules/host-pkg": {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/host-pkg/-/host-pkg-1.0.0.tgz",
      },
      "node_modules/host-pkg/node_modules/inner": {
        version: "2.0.0",
        inBundle: true,
        resolved: "https://evil.example/inner-2.0.0.tgz",
      },
    });

    expect(summarize(makeLockfile({}), after)).toMatchObject({
      changes: {
        added: [
          { name: "host-pkg" },
          {
            name: "inner",
            hosts: ["https://evil.example/inner-{version}.tgz"],
          },
        ],
      },
    });
  });

  it.each([
    ["a parent that does not list it", [], "2.0.0"],
    ["a version that is not plain semver", ["inner"], "2.0.0/../../evil"],
  ])(
    "reads a bundled record under %s as unknown host",
    (_label, bundles, version) => {
      const after = makeLockfile({
        "node_modules/host-pkg": {
          version: "1.0.0",
          resolved: "https://registry.npmjs.org/host-pkg/-/host-pkg-1.0.0.tgz",
          bundleDependencies: bundles,
        },
        "node_modules/host-pkg/node_modules/inner": { version, inBundle: true },
      });
      const summary = summarize(makeLockfile({}), after);
      const added =
        summary !== undefined && "changes" in summary
          ? summary.changes.added
          : [];

      expect(added.find((pkg) => pkg.name === "inner")?.hosts).toBeUndefined();
    },
  );

  it("reads a bundled v1 dependency off plain semver as unknown host", () => {
    const v1 = JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        a: {
          version: "1.0.0",
          resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz",
          dependencies: { inner: { version: "file:../evil", bundled: true } },
        },
      },
    });
    const empty = JSON.stringify({ lockfileVersion: 1, dependencies: {} });
    const summary = summarize(empty, v1);
    const added =
      summary !== undefined && "changes" in summary
        ? summary.changes.added
        : [];

    expect(added.find((pkg) => pkg.name === "inner")?.hosts).toBeUndefined();
  });

  it("reads a bundled v1 dependency from its parent's host", () => {
    const v1 = JSON.stringify({
      lockfileVersion: 1,
      dependencies: {
        a: {
          version: "1.0.0",
          resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz",
          dependencies: { inner: { version: "2.0.0", bundled: true } },
        },
      },
    });
    const empty = JSON.stringify({ lockfileVersion: 1, dependencies: {} });

    expect(summarize(empty, v1)).toMatchObject({
      changes: {
        added: [
          { name: "a", hosts: ["registry:https://registry.npmjs.org"] },
          { name: "inner", hosts: ["registry:https://registry.npmjs.org"] },
        ],
      },
    });
  });

  it("reads lockfile v1 nested dependencies", () => {
    const v1 = (version: string) =>
      JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          a: { version: "1.0.0", dependencies: { zod: { version } } },
        },
      });

    expect(summarize(v1("3.22.0"), v1("3.23.8"))).toMatchObject({
      changes: { updated: [{ name: "zod", from: "3.22.0", to: "3.23.8" }] },
    });
  });

  it.each([
    [
      "a repeated key",
      AFTER.replace(
        '"node_modules/react"',
        '"node_modules/lodash": { "version": "4.17.21" },\n    "node_modules/react"',
      ),
    ],
    [
      "a repeated escaped key",
      AFTER.replace(
        '"node_modules/react"',
        '"node_modules/\\u006codash": { "version": "4.17.21" },\n    "node_modules/react"',
      ),
    ],
  ])("reads a lockfile with %s as ambiguous", (_label, after) => {
    expect(summarize(BEFORE, after)).toEqual({
      format: "npm",
      unread: "ambiguous",
    });
  });

  it("reads a v1 tree alias as the alias its packages record names", () => {
    const aliased = (version: string) => {
      const record = {
        resolved: `https://registry.npmjs.org/string-width/-/string-width-${version}.tgz`,
        integrity: `sha512-${version}`,
      };
      return JSON.stringify({
        lockfileVersion: 2,
        packages: {
          "": {},
          "node_modules/string-width-cjs": {
            name: "string-width",
            version,
            ...record,
          },
        },
        dependencies: {
          "string-width-cjs": {
            version: `npm:string-width@${version}`,
            ...record,
          },
        },
      });
    };

    const summary = summarize(aliased("4.2.3"), aliased("4.2.4"));

    expect(summary).toMatchObject({
      changes: {
        updated: [
          {
            name: "string-width-cjs",
            from: "4.2.3",
            to: "4.2.4",
            fromHosts: ["registry:https://registry.npmjs.org"],
            toHosts: ["registry:https://registry.npmjs.org"],
            fromAliasOf: "string-width",
            toAliasOf: "string-width",
          },
        ],
      },
    });
    expect(summary).toMatchObject({ changes: { updated: { length: 1 } } });
  });

  it("reads a v1 URL version as the source npm fetches", () => {
    const pinned = (tag: string) =>
      JSON.stringify({
        lockfileVersion: 1,
        dependencies: {
          foo: {
            version: `https://codeload.github.com/acme/foo/tar.gz/${tag}`,
            integrity: `sha512-${tag}`,
          },
        },
      });

    const summary = summarize(pinned("v1.0.0"), pinned("v1.0.1"));

    const repository = "https://codeload.github.com/acme/foo/tar.gz/";
    expect(summary).toMatchObject({
      changes: {
        updated: [
          { name: "foo", fromHosts: [repository], toHosts: [repository] },
        ],
      },
    });
  });

  it("reads text that is not JSON as unparseable", () => {
    expect(summarize(BEFORE, "{ not json")).toEqual({
      format: "npm",
      unread: "unparseable",
    });
  });
});
