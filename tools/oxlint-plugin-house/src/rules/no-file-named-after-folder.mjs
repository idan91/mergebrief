import { posix } from "node:path";

const TEST_MARKERS = new Set(["test", "spec"]);
const COMPONENT_FOLDER = /^[A-Z][A-Za-z0-9]*$/;
const HOOK_FOLDER = /^use[A-Z][A-Za-z0-9]*$/;

/** @param {string} name */
function normalizeName(name) {
  return name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

/**
 * A component's or hook folder's test takes the unit's name. A task's
 * per-concern test folder names each file for its concern, so it never
 * needs an exception here.
 * @param {string} folder
 */
function isMirroredTest(folder) {
  return COMPONENT_FOLDER.test(folder) || HOOK_FOLDER.test(folder);
}

/** @type {import("../types").RuleDefinition} */
export const noFileNamedAfterFolder = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "No source file carries its folder's name; a folder's main file is its index.",
    },
    messages: {
      violation:
        "`{{file}}` carries its folder's name: name it `index` so callers import `{{folder}}`, or name it for what it owns.",
    },
  },
  create(context) {
    return {
      Program(node) {
        const normalized = context.filename.replaceAll("\\", "/");
        const file = posix.basename(normalized);
        const folderPath = posix.dirname(normalized);
        const folder = posix.basename(folderPath);
        const [stem = "", ...suffixes] = file.split(".");

        const sameName = normalizeName(stem) === normalizeName(folder);
        if (!sameName || stem === "") {
          return;
        }
        const isTest = suffixes.some((suffix) => TEST_MARKERS.has(suffix));
        if (isTest && isMirroredTest(folder)) {
          return;
        }

        context.report({
          node,
          messageId: "violation",
          data: { file, folder },
        });
      },
    };
  },
};
