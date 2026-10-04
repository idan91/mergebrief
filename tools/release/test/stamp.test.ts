import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  pruneManifest,
  pruneTree,
  stampComposeImage,
  stampPackage,
  stampTree,
} from "../src/logic/stamp";
import { makeTempRoot, writeTree } from "./helpers";

const PACKAGE_JSON = `{
  "name": "mergebrief",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "mergebrief": "dist/mergebrief.js"
  },
  "dependencies": {
    "i18n": "workspace:*"
  },
  "devDependencies": {
    "tsup": "^8.5.0"
  }
}
`;

const COMPOSE = `services:
  postgres:
    image: postgres:17-alpine
  api:
    image: ghcr.io/idan91/mergebrief:dev
    build:
      context: .
    command: api
  web:
    image: ghcr.io/idan91/mergebrief:dev # served on 3000
    command: web
  probe:
    image: ghcr.io/idan91/mergebrief:devel
    # image: ghcr.io/idan91/mergebrief:dev
`;

function makeRepo(): string {
  const root = makeTempRoot();
  writeTree(root, {
    "apps/cli/package.json": PACKAGE_JSON,
    "docker-compose.yml": COMPOSE,
    "docker-compose.external-db.yml": COMPOSE,
  });
  return root;
}

describe("stamping the release version", () => {
  it("writes the version and keeps every other key in place", () => {
    const root = makeRepo();
    const path = join(root, "apps/cli/package.json");

    const result = stampPackage(path, "0.1.0");

    expect(result.ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(
      PACKAGE_JSON.replace('"version": "0.0.0"', '"version": "0.1.0"'),
    );
  });

  it("the prune drops private and the bundled dependencies", () => {
    const root = makeRepo();
    const path = join(root, "apps/cli/package.json");
    stampPackage(path, "0.1.0");

    const result = pruneManifest(path);

    expect(result.ok).toBe(true);
    expect(readFileSync(path, "utf8")).toBe(`{
  "name": "mergebrief",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "mergebrief": "dist/mergebrief.js"
  },
  "devDependencies": {
    "tsup": "^8.5.0"
  }
}
`);
  });

  it("the prune refuses a manifest still on the dev sentinel", () => {
    const root = makeRepo();

    const result = pruneTree(root);

    expect(!result.ok && result.error.reason).toContain("stamp the release");
    expect(readFileSync(join(root, "apps/cli/package.json"), "utf8")).toBe(
      PACKAGE_JSON,
    );
  });

  it("refuses a manifest without a string version", () => {
    const root = makeRepo();
    const path = join(root, "apps/cli/package.json");
    writeTree(root, {
      "apps/cli/package.json": '{ "name": "x", "version": 1 }\n',
    });

    const result = stampPackage(path, "0.1.0");

    expect(!result.ok && result.error.reason).toContain("string version");
  });

  it("refuses to stamp a manifest that is not the dev sentinel", () => {
    const root = makeRepo();
    const path = join(root, "apps/cli/package.json");
    stampPackage(path, "0.1.0");

    const result = stampPackage(path, "0.1.1");

    expect(!result.ok && result.error.reason).toContain("0.1.0");
  });

  it("swaps every dev image pin and nothing else", () => {
    const root = makeRepo();
    const path = join(root, "docker-compose.yml");

    const result = stampComposeImage(path, "0.1.0");

    expect(result.ok && result.value).toBe(2);
    expect(readFileSync(path, "utf8")).toBe(`services:
  postgres:
    image: postgres:17-alpine
  api:
    image: ghcr.io/idan91/mergebrief:0.1.0
    build:
      context: .
    command: api
  web:
    image: ghcr.io/idan91/mergebrief:0.1.0 # served on 3000
    command: web
  probe:
    image: ghcr.io/idan91/mergebrief:devel
    # image: ghcr.io/idan91/mergebrief:dev
`);
  });

  it("refuses a compose file with no dev pin", () => {
    const root = makeRepo();
    const path = join(root, "docker-compose.yml");
    stampComposeImage(path, "0.1.0");

    const result = stampComposeImage(path, "0.1.0");

    expect(!result.ok && result.error.reason).toBe(
      "no image: ghcr.io/idan91/mergebrief:dev line",
    );
  });

  it("stamps the whole tree in one call and reports the files", () => {
    const root = makeRepo();

    const result = stampTree(root, "0.2.0-rc.1");

    expect(result.ok && result.value).toEqual([
      "apps/cli/package.json",
      "docker-compose.yml",
      "docker-compose.external-db.yml",
    ]);
    expect(
      readFileSync(join(root, "docker-compose.external-db.yml"), "utf8"),
    ).toContain("image: ghcr.io/idan91/mergebrief:0.2.0-rc.1");
  });

  it("writes nothing when one compose file has no pin", () => {
    const root = makeRepo();
    writeTree(root, {
      "docker-compose.external-db.yml": "services:\n  api:\n    image: other\n",
    });

    const result = stampTree(root, "0.1.0");

    expect(
      !result.ok &&
        result.error.path.endsWith("docker-compose.external-db.yml"),
    ).toBe(true);
    expect(readFileSync(join(root, "apps/cli/package.json"), "utf8")).toBe(
      PACKAGE_JSON,
    );
    expect(readFileSync(join(root, "docker-compose.yml"), "utf8")).toBe(
      COMPOSE,
    );
  });

  it("refuses a version outside the grammar before touching a file", () => {
    const root = makeRepo();

    const result = stampTree(root, "latest");

    expect(result.ok).toBe(false);
    expect(readFileSync(join(root, "apps/cli/package.json"), "utf8")).toBe(
      PACKAGE_JSON,
    );
  });
});
