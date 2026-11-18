// Package and feature boundaries. Package edges come from each member's
// package.json at load; the hand rules hold the workspace kinds and the
// apps/web feature shape. There is no baseline: the graph is clean, and
// `check:baselines` refuses a new records file.
const fs = require("node:fs");
const path = require("node:path");

const MEMBER_DIRS = ["apps", "packages", "tools"];
const APPS = ["web", "api", "worker", "cli", "docs-site"];

function readMembers() {
  const members = [];
  for (const kind of MEMBER_DIRS) {
    for (const name of fs.readdirSync(kind)) {
      const manifestPath = path.join(kind, name, "package.json");
      if (!fs.existsSync(manifestPath)) {
        continue;
      }
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

// A module inside a test-utils folder, or one named test-utils.
const TEST_UTILS_MODULE = "/test-utils(/|\\.tsx?$)";

// The Brief data fixtures: a model-layer module model tests may import.
const BRIEF_FIXTURES = "^apps/web/src/features/brief/test-utils/fixtures\\.ts$";

// The files behind the leaf subpaths of brief-core and generators: what a
// member other than the worker and the tools may name by value.
const LEAF_SUBPATH_FILES = [
  "^packages/brief-core/src/(types|path-matching|hidden-chars)\\.ts$",
  "^packages/brief-core/src/(pr-stack|artifact|diff/chunk-layout|diff/pr-span|media|media-address|sanitized-markdown)/",
  "^packages/brief-core/src/(github/pr-url|diff/remap)\\.ts$",
  "^packages/generators/src/contract/generation\\.ts$",
  "^packages/generators/src/config/(instancePolicy|trackers)\\.ts$",
];

// Matches the resolved file and the bare name of an import that did not resolve.
const PROVIDER_SDKS = "(^|node_modules/)(@anthropic-ai/sdk|openai)(/|$)";

// The adapters, the harness, the generation engine and the provider SDKs:
// what an api process must never load.
const GENERATION_GRAPH = [
  "^packages/generators/src/(adapters|harness)/",
  "^packages/brief-core/src/generation/",
  PROVIDER_SDKS,
];

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
      name: "path-matcher-imports-nothing",
      comment:
        "The shared path matcher is in the browser bundle: it pulls in no runtime code. A type-only import is erased and stays legal.",
      severity: "error",
      from: { path: "^packages/brief-core/src/path-matching\\.ts$" },
      to: { path: ".*", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "hidden-chars-imports-nothing",
      comment:
        "The hidden-character escapes are in the browser bundle: they pull in no runtime code. A type-only import is erased and stays legal.",
      severity: "error",
      from: { path: "^packages/brief-core/src/hidden-chars\\.ts$" },
      to: { path: ".*", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "chunk-layout-imports-only-types",
      comment:
        "The chunk slicer and its counts run in the browser and in the worker: they pull in no runtime code beyond the zero-dependency types package. A type-only import is erased and stays legal.",
      severity: "error",
      from: { path: "^packages/brief-core/src/diff/chunk-layout/" },
      to: {
        path: ".*",
        pathNot: [
          "^packages/types/",
          "^packages/brief-core/src/diff/chunk-layout/",
        ],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "media-address-imports-only-types",
      comment:
        "The committed-file address parser runs in the browser and in the api: it pulls in no runtime code beyond the zero-dependency types package. A type-only import is erased and stays legal.",
      severity: "error",
      from: { path: "^packages/brief-core/src/media-address/" },
      to: {
        path: ".*",
        pathNot: [
          "^packages/types/",
          "^packages/brief-core/src/media-address/",
        ],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "sanitized-markdown-imports-no-workspace-runtime",
      comment:
        "The one Markdown pipeline runs in the browser and in the worker: it pulls in the unified plugins and no workspace runtime code. A type-only import is erased and stays legal.",
      severity: "error",
      from: { path: "^packages/brief-core/src/sanitized-markdown/" },
      to: {
        path: "^(packages|apps|tools)/",
        pathNot: "^packages/brief-core/src/sanitized-markdown/",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "media-imports-only-its-pipeline",
      comment:
        "Media extraction runs in the browser and in the worker: of the workspace it loads only the Markdown pipeline, the address normaliser, the attachment address parser in contract and types. A type-only import is erased and stays legal.",
      severity: "error",
      from: { path: "^packages/brief-core/src/media/" },
      to: {
        path: "^(packages|apps|tools)/",
        pathNot: [
          "^packages/types/",
          "^packages/contract/src/attachments/",
          "^packages/brief-core/src/(media|media-address|sanitized-markdown)/",
        ],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "pr-url-imports-nothing",
      comment:
        "The PR url parser is the leaf the api loads to read a pasted url: it pulls in no runtime code, the exec plumbing beside it included. A type-only import is erased and stays legal.",
      severity: "error",
      from: { path: "^packages/brief-core/src/github/pr-url\\.ts$" },
      to: { path: ".*", dependencyTypesNot: ["type-only"] },
    },
    {
      name: "repo-config-imports-generators-only-through-trackers",
      comment:
        "repo-config takes the tracker schemas from generators and nothing else of it. A type-only import is erased and stays legal.",
      severity: "error",
      from: { path: "^packages/repo-config/src/" },
      to: {
        path: "^packages/generators/",
        pathNot: "^packages/generators/src/config/trackers\\.ts$",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "generation-contract-imports-only-zod-and-types",
      comment:
        "The generation vocabulary is the browser-safe generators subpath: its only runtime imports are zod and the zero-dependency types package. A type-only import is erased and stays legal.",
      severity: "error",
      from: { path: "^packages/generators/src/contract/generation\\.ts$" },
      to: {
        path: ".*",
        pathNot: ["node_modules/zod/", "^packages/types/"],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "instance-policy-imports-no-adapter",
      comment:
        "The instance-policy subpath loads no adapter: the only workspace code it reaches is its own config leaves (drafts, spend, operators, allowed, attachments, audit, updateCheck, the moved-variable list, the root reader and consts), the config error shape and the types package. npm imports of those are not held here.",
      severity: "error",
      from: { path: "^packages/generators/src/config/instancePolicy\\.ts$" },
      to: {
        reachable: true,
        path: "^(apps|packages|tools)/",
        pathNot: [
          "^packages/generators/src/config/(allowed|attachments|audit|consts|instancePolicy|moved-variables|operators|readRoot|spendPolicy|update-check)\\.ts$",
          "^packages/generators/src/contract/errors\\.ts$",
          "^packages/types/",
        ],
      },
    },
    {
      name: "brief-types-import-only-leaves",
      comment:
        "The Brief shape loads in a browser: all it reaches is zod, the types package, the generation vocabulary, its own pr-stack folder and the Media key's type and guard.",
      severity: "error",
      from: { path: "^packages/brief-core/src/types\\.ts$" },
      to: {
        reachable: true,
        path: ".*",
        pathNot: [
          "node_modules/zod/",
          "^packages/types/",
          "^packages/generators/src/contract/generation\\.ts$",
          "^packages/brief-core/src/(types\\.ts$|pr-stack/|media/(key|types)\\.ts$)",
        ],
      },
    },
    {
      name: "artifact-module-imports-only-leaves",
      comment:
        "The stored-artifact schemas and checks load in a browser: all they reach is zod, the types package, the Brief shape with its generation vocabulary, pr-stack folder and Media key guard, the chunk-layout leaf (itself held to the types package) and the artifact folder itself.",
      severity: "error",
      from: { path: "^packages/brief-core/src/artifact/" },
      to: {
        reachable: true,
        path: ".*",
        pathNot: [
          "node_modules/zod/",
          "^packages/types/",
          "^packages/generators/src/contract/generation\\.ts$",
          "^packages/brief-core/src/(types\\.ts$|pr-stack/|artifact/|diff/chunk-layout/|media/(key|types)\\.ts$)",
        ],
      },
    },
    {
      name: "brief-core-entry-only-worker-and-tools",
      comment:
        "The brief-core entry loads the whole generation graph, so only the worker and the tools name it; every other member imports a leaf subpath. A type-only import is erased and stays legal.",
      severity: "error",
      from: {
        path: "^(apps|packages|tools)/",
        pathNot: ["^apps/worker/", "^tools/", "^packages/brief-core/"],
      },
      to: {
        path: "^packages/brief-core/src/index\\.ts$",
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "generation-graph-named-only-through-leaf-subpaths",
      comment:
        "Outside the worker and the tools, a value import into brief-core or generators lands on a leaf subpath file, and only generators names a provider SDK. A type-only import is erased and stays legal.",
      severity: "error",
      from: {
        path: "^(apps|packages|tools)/",
        pathNot: [
          "^apps/worker/",
          "^tools/",
          "^packages/(brief-core|generators)/",
        ],
      },
      to: {
        path: ["^packages/(brief-core|generators)/src/", PROVIDER_SDKS],
        pathNot: LEAF_SUBPATH_FILES,
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "leaf-subpaths-load-no-generation-graph",
      comment:
        "No leaf subpath file reaches an adapter, the harness, the dev CLI, the generation engine or a provider SDK, type-only imports included. With the rule above, this is what keeps the api process from loading them.",
      severity: "error",
      from: { path: LEAF_SUBPATH_FILES },
      to: { reachable: true, path: GENERATION_GRAPH },
    },
    {
      name: "cli-imports-only-brief-core-leaves",
      comment:
        "The CLI bundle inlines every import: of brief-core it takes only the two leaves that import nothing beyond types, type-only imports included.",
      severity: "error",
      from: { path: "^apps/cli/" },
      to: {
        path: "^packages/brief-core/",
        pathNot:
          "^packages/brief-core/src/(hidden-chars\\.ts$|diff/chunk-layout/)",
      },
    },
    {
      name: "contract-imports-no-runtime",
      comment:
        "The wire contract rides in the browser bundle through apps/web's isomorphic fetch boundary: its source reaches only contract and the zero-dependency types package, type-only imports included.",
      severity: "error",
      from: { path: "^packages/contract/src/" },
      to: { path: ".*", pathNot: "^packages/(contract|types)/" },
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
      name: "no-source-imports-a-tool",
      comment:
        "Tools are run by hand or by CI and lint; app and package source never imports one.",
      severity: "error",
      from: { path: "^(?:apps|packages)/[^/]+/src/" },
      to: { path: "^tools/" },
    },
    {
      name: "runtime-source-imports-no-dev-dependency",
      comment:
        "The image installs production dependencies only, so a value import of a devDependency from shipped source resolves in dev and fails in the image.",
      severity: "error",
      from: {
        path: "^(apps/(api|worker|web)|packages/[^/]+)/src/",
        pathNot: "(\\.test\\.|\\.stories\\.|/test/|/testing/|/test-utils)",
      },
      to: {
        dependencyTypes: ["npm-dev"],
        dependencyTypesNot: ["type-only"],
      },
    },
    {
      name: "no-circular",
      comment:
        "An import cycle whose edges are all runtime imports is an error. A cycle with a type-only hop erases at build and passes, the way a types.ts reads the types of its sibling schemas.ts. Depcruise checks one cycle per edge, so a runtime cycle that also has a type-only path around it can go unreported.",
      severity: "error",
      from: {},
      to: {
        circular: true,
        dependencyTypesNot: ["type-only"],
        viaOnly: { dependencyTypesNot: ["type-only"] },
      },
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
      name: "web-brief-model-imports-no-feature",
      comment:
        "The Brief model, the queries module and the data fixtures are the bottom layer: they import no other feature and nothing of the Brief ui layer. A model test reaches test-utils/fixtures only, never the test-utils index that loads the render helpers. Type-only imports included.",
      severity: "error",
      from: {
        path: [
          "^apps/web/src/features/brief/(model/|queries\\.ts$)",
          BRIEF_FIXTURES,
        ],
      },
      to: {
        path: "^apps/web/src/features/",
        pathNot: [
          "^apps/web/src/features/brief/model/",
          "^apps/web/src/features/brief/queries\\.ts$",
          BRIEF_FIXTURES,
        ],
      },
    },
    {
      name: "web-review-imports-brief-model-only",
      comment:
        "Review sits beside the Brief ui layer, not above it: it reaches the Brief feature through the model index and the test-utils index only.",
      severity: "error",
      from: { path: "^apps/web/src/features/review/" },
      to: {
        path: "^apps/web/src/features/brief/",
        pathNot: [
          "^apps/web/src/features/brief/model/index\\.ts$",
          "^apps/web/src/features/brief/test-utils/index\\.ts$",
        ],
      },
    },
    {
      name: "web-pulls-imports-brief-entries-only",
      comment:
        "Pulls composes the Brief ui layer: it reaches the Brief feature through its entry, the model index, the queries module and the test-utils index, never a ui or model file directly.",
      severity: "error",
      from: { path: "^apps/web/src/features/pulls/" },
      to: {
        path: "^apps/web/src/features/brief/",
        pathNot: [
          "^apps/web/src/features/brief/index\\.tsx$",
          "^apps/web/src/features/brief/model/index\\.ts$",
          "^apps/web/src/features/brief/(queries|test-utils/index)\\.ts$",
        ],
      },
    },
    {
      name: "web-brief-never-imports-pulls",
      comment:
        "Pulls composes the Brief ui layer, so that layer and the Brief entry never import pulls. web-brief-model-imports-no-feature holds the model.",
      severity: "error",
      from: {
        path: "^apps/web/src/features/brief/",
        pathNot: "^apps/web/src/features/brief/model/",
      },
      to: { path: "^apps/web/src/features/pulls/" },
    },
    {
      name: "web-source-reaches-no-yaml-reader",
      comment:
        "The browser bundle ships no YAML reader, type-only imports included: web takes repo-config's caps from `repo-config/constants`, never the barrel that holds the validator.",
      severity: "error",
      from: {
        path: "^apps/web/src/",
        pathNot: ["\\.test\\.tsx?$", "(^|/)test-utils(/|\\.tsx?$)"],
      },
      to: { reachable: true, path: "node_modules/yaml/" },
    },
    {
      name: "web-test-utils-only-in-tests",
      comment:
        "Test-utils modules hold test helpers and fixtures: only a test file or another test-utils module imports one, so none reaches a bundle.",
      severity: "error",
      from: {
        path: "^apps/web/",
        pathNot: ["\\.test\\.tsx?$", TEST_UTILS_MODULE],
      },
      to: { path: `^apps/web/.*${TEST_UTILS_MODULE}` },
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
    // `doNotFollow`, not `exclude`: an excluded dependency is dropped from the
    // graph before the rules run, which would make an npm value import from
    // `packages/contract` invisible to `contract-imports-no-runtime`. Not
    // following keeps each npm dependency as a leaf the rules can still see.
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: [
        "\\.gen\\.",
        "^(apps|packages|tools)/[^/]+/dist(-demo)?/",
        "^apps/web/e2e/",
        "^apps/docs-site/\\.vitepress/(cache|dist|\\.temp)/",
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
