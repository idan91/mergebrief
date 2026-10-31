import { describe, expect, it } from "vitest";
import {
  comparePackageEntries,
  readFetchIdentity,
} from "../../../../src/generation/shortened/lockfiles/utils";

const MANY_VERSIONS = 200_000;

describe("package entry comparison", () => {
  it("lists more versions of one name than a call takes arguments", () => {
    const before = Array.from({ length: MANY_VERSIONS }, (_unused, index) => ({
      name: "x",
      version: `1.0.${index}`,
      source: "registry",
    }));

    const changes = comparePackageEntries(before, []);

    expect(changes.removed).toHaveLength(MANY_VERSIONS);
  });
});

const FOO = { name: "foo", version: "1.0.0" };
const NEAR_MATCHES = 1_000_000;

describe("fetch identity", () => {
  it.each([
    [
      "its own registry tarball",
      "https://registry.npmjs.org/foo/-/foo-1.0.0.tgz",
      "https://registry.npmjs.org",
    ],
    [
      "another package's tarball",
      "https://registry.npmjs.org/evil/-/evil-1.0.0.tgz",
      "https://registry.npmjs.org/evil/-/evil-{version}.tgz",
    ],
    [
      "a flat host's artifact",
      "https://pkg.pr.new/foo@abc123",
      "https://pkg.pr.new/foo@abc123",
    ],
    [
      "a query that names it",
      "https://nexus.corp/download?name=foo&version=1.0.0",
      "https://nexus.corp/download?name=foo&version={version}",
    ],
    [
      "a commit under owner and repo",
      "https://codeload.github.com/acme/foo/tar.gz/abc123",
      "https://codeload.github.com/acme/foo/tar.gz/",
    ],
    [
      "a git repository",
      "git+https://github.com/acme/foo.git#abc123",
      "git+https://github.com/acme/foo.git",
    ],
    [
      "its own registry tarball over plain http",
      "http://registry.npmjs.org/foo/-/foo-1.0.0.tgz",
      "http://registry.npmjs.org",
    ],
    [
      "an artifact named without its version on a plain host",
      "https://cdn.example/artifacts/pkgs/foo-abc123.tgz",
      "https://cdn.example/artifacts/pkgs/foo-abc123.tgz",
    ],
    [
      "a version in a directory segment",
      "https://cdn.example/pkgs/1.0.0/foo.tgz",
      "https://cdn.example/pkgs/{version}/foo.tgz",
    ],
    [
      "a repository over ssh with git's login",
      "git+ssh://git@github.com/acme/foo.git#abc123",
      "git+ssh://github.com/acme/foo.git",
    ],
    [
      "git's login outside ssh",
      "https://git@mirror.example/foo.tgz",
      undefined,
    ],
    ["a hostless shorthand", "github:acme/foo#abc123", "github:acme/foo"],
    ["a host spelled like the registry", "http://registry/foo.tgz", undefined],
    ["a credentialed url", "https://user:pw@mirror.example/foo.tgz", undefined],
  ])("reads %s", (_label, spec, identity) => {
    expect(readFetchIdentity(spec, FOO)).toBe(identity);
  });

  it.each([
    [
      "a version in one name token",
      "https://h.example/evil1-1.tgz",
      "1",
      "https://h.example/evil1-{version}.tgz",
    ],
    [
      "a v-prefixed version",
      "https://h.example/acme/foo/archive/v1.0.0.tar.gz",
      "1.0.0",
      "https://h.example/acme/foo/archive/v{version}.tar.gz",
    ],
    [
      "a version holding query syntax",
      "https://h.example/d?v=1.0.1&name=evil",
      "1.0.1&name=evil",
      "https://h.example/d?v=1.0.1&name=evil",
    ],
  ])(
    "marks %s only as a whole version token",
    (_label, spec, version, identity) => {
      expect(readFetchIdentity(spec, { name: "x", version })).toBe(identity);
    },
  );

  it("marks a version against near-matching text in one pass", () => {
    const version = `${"a-".repeat(511)}b`;
    const spec = `https://h.example/d?q=${"a-".repeat(NEAR_MATCHES)}`;

    expect(readFetchIdentity(spec, { name: "x", version })).toBe(spec);
  });

  it("reads an scp-style repository by its whole path", () => {
    expect(readFetchIdentity("github.com:acme/foo.git", FOO, true)).toBe(
      "github.com:acme/foo.git",
    );
  });
});
