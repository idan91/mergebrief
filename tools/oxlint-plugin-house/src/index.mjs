// The house oxlint plugin: every repo convention oxlint has no native rule
// for, as selector rules. `.oxlintrc.json` loads it through `jsPlugins`.
import { commentRun } from "./rules/comment-run.mjs";
import { extensionlessImport } from "./rules/extensionless-import.mjs";
import { noBlankTarget } from "./rules/no-blank-target.mjs";
import { noConditionalSpread } from "./rules/no-conditional-spread.mjs";
import { noEmDash } from "./rules/no-em-dash.mjs";
import { noEnum } from "./rules/no-enum.mjs";
import { noRawButton } from "./rules/no-raw-button.mjs";
import { testTitle } from "./rules/test-title.mjs";

/** @type {import("./types").HousePlugin} */
const plugin = {
  meta: { name: "house" },
  rules: {
    "no-enum": noEnum,
    "extensionless-import": extensionlessImport,
    "no-raw-button": noRawButton,
    "no-blank-target": noBlankTarget,
    "no-conditional-spread": noConditionalSpread,
    "test-title": testTitle,
    "comment-run": commentRun,
    "no-em-dash": noEmDash,
  },
};

export default plugin;
