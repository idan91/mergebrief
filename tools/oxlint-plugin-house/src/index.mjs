// The house oxlint plugin: every repo convention oxlint has no native rule
// for, as selector rules. `.oxlintrc.json` loads it through `jsPlugins`.
import { commentDensity } from "./rules/comment-density.mjs";
import { commentRun } from "./rules/comment-run.mjs";
import { extensionlessImport } from "./rules/extensionless-import.mjs";
import { noBlankTarget } from "./rules/no-blank-target.mjs";
import { noConditionalSpread } from "./rules/no-conditional-spread.mjs";
import { noEmDash } from "./rules/no-em-dash.mjs";
import { noEnum } from "./rules/no-enum.mjs";
import { noHandBuiltPlural } from "./rules/no-hand-built-plural.mjs";
import { noProcessEnv } from "./rules/no-process-env.mjs";
import { noRenderFunction } from "./rules/no-render-function.mjs";
import { noRawButton } from "./rules/no-raw-button.mjs";
import { testTitle } from "./rules/test-title.mjs";
import { typesConstMaps } from "./rules/types-const-maps.mjs";

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
    "comment-density": commentDensity,
    "no-em-dash": noEmDash,
    "no-render-function": noRenderFunction,
    "no-process-env": noProcessEnv,
    "no-hand-built-plural": noHandBuiltPlural,
    "types-const-maps": typesConstMaps,
  },
};

export default plugin;
