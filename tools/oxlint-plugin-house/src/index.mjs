// The house oxlint plugin: every repo convention oxlint has no native rule
// for, as selector rules. `.oxlintrc.json` loads it through `jsPlugins`.
import { extensionlessImport } from "./rules/extensionless-import.mjs";
import { noBlankTarget } from "./rules/no-blank-target.mjs";
import { noEnum } from "./rules/no-enum.mjs";
import { noRawButton } from "./rules/no-raw-button.mjs";

/** @type {import("./types").HousePlugin} */
const plugin = {
  meta: { name: "house" },
  rules: {
    "no-enum": noEnum,
    "extensionless-import": extensionlessImport,
    "no-raw-button": noRawButton,
    "no-blank-target": noBlankTarget,
  },
};

export default plugin;
