// Package and feature boundaries. Package edges come from each member's
// package.json at load; the hand rules hold the workspace kinds and the
// apps/web feature shape. The known-violations file only loses entries.
const fs = require("node:fs");
const path = require("node:path");

const MEMBER_DIRS = ["apps", "packages", "tools"];
const APPS = ["web", "api", "worker", "cli"];

function readMembers() {
  const members = [];
  for (const kind of MEMBER_DIRS) {
    for (const name of fs.readdirSync(kind)) {
      const manifestPath = path.join(kind, name, "package.json");
      if (!fs.existsSync(manifestPath)) continue;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      const deps = { ...manifest.dependencies, ...manifest.devDependencies };
      const workspaceDeps = Object.keys(deps).filter((dep) =>
        String(deps[dep]).startsWith("workspace:"),
      );
      members.push({
        kind,
        dir: `${kind}/${name}`,
        name: manifest.name,
        workspaceDeps,
      });
    }
  }
  return members;
}

const members = readMembers();
const memberByName = new Map(members.map((member) => [member.name, member]));

/** One rule per member: it may reach only the workspace packages it declares. */
function buildPackageEdgeRules() {
  return members.map((member) => {
    const allowedDirs = member.workspaceDeps
      .map((dep) => memberByName.get(dep))
      .filter((dep) => dep !== undefined)
      .map((dep) => dep.dir);
    const otherDirs = members
      .filter(
        (other) => other.dir !== member.dir && !allowedDirs.includes(other.dir),
      )
      .map((other) => other.dir);
    return {
      name: `declared-edges:${member.name}`,
      comment: `${member.dir} imports only the workspace members its package.json declares`,
      severity: "error",
      from: { path: `^${member.dir}/` },
      to: {
        path: otherDirs.length === 0 ? "^$" : `^(${otherDirs.join("|")})/`,
      },
    };
  });
}

const appDirs = APPS.map((app) => `apps/${app}`);

// A feature's index, a file one segment below it, or that segment's index.
const WEB_FEATURE_PUBLIC_SHAPES =
  "^apps/web/src/features/[^/]+/(index\\.tsx?|[^/]+\\.tsx?|[^/]+/index\\.tsx?)$";

module.exports = {
  forbidden: [
    ...buildPackageEdgeRules(),
    {
      name: "foundation-packages-import-only-types",
      comment: "Logging, i18n and generators may depend only on types.",
      severity: "error",
      from: { path: "^packages/(logging|i18n|generators)/" },
      to: {
        path: "^(apps|packages|tools)/",
        pathNot: ["^packages/types/", "^packages/$1/"],
      },
    },
    {
      name: "types-has-no-workspace-dependencies",
      comment:
        "The types package has no workspace dependencies, even if declared.",
      severity: "error",
      from: { path: "^packages/types/" },
      to: { path: "^(apps|packages|tools)/", pathNot: "^packages/types/" },
    },
    {
      name: "no-app-imports-another-app",
      comment: "Apps talk over HTTP or the job queue, never by import.",
      severity: "error",
      from: { path: "^apps/([^/]+)/" },
      to: { path: `^(${appDirs.join("|")})/`, pathNot: "^apps/$1/" },
    },
    {
      name: "no-package-imports-an-app",
      comment: "Nothing imports an app, tests included.",
      severity: "error",
      from: { path: "^(?:packages|tools)/" },
      to: { path: `^(${appDirs.join("|")})/` },
    },
    {
      name: "web-feature-imports-through-index",
      comment:
        "Another feature is imported through its index or one segment below it.",
      severity: "error",
      from: { path: "^apps/web/src/features/([^/]+)/" },
      to: {
        path: "^apps/web/src/features/[^/]+/",
        pathNot: ["^apps/web/src/features/$1/", WEB_FEATURE_PUBLIC_SHAPES],
      },
    },
    {
      name: "web-routes-import-feature-index",
      comment:
        "Outside the features tree, a feature is imported through its index or one segment below it.",
      severity: "error",
      from: { path: "^apps/web/src/", pathNot: "^apps/web/src/features/" },
      to: {
        path: "^apps/web/src/features/[^/]+/",
        pathNot: WEB_FEATURE_PUBLIC_SHAPES,
      },
    },
    {
      name: "web-global-never-imports-features",
      comment:
        "Global src folders never import src/features; routes may import feature indexes.",
      severity: "error",
      from: { path: "^apps/web/src/(components|hooks|utils|data|test)/" },
      to: { path: "^apps/web/src/features/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: [
        "node_modules",
        "\\.gen\\.",
        "^apps/web/e2e/",
        "^tools/oxlint-plugin-house/test/fixtures/",
        "^packages/persistence/drizzle/",
        "\\.(scss|css|svg|json)$",
      ],
    },
    tsPreCompilationDeps: true,
    webpackConfig: { fileName: ".dependency-cruiser.alias.cjs" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types"],
      extensions: [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", ".d.ts"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
