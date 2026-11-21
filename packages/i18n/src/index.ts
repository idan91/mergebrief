// ENTRY: the package's public surface (`package.json` `exports["."]`).

// The factory: shipped catalogs baked in, pseudo postProcessor registered.
export { createI18n, type CreateI18nOptions } from "./create";

// Locale registry: the picker's curated list and the baked resource map.
export { LOCALES, RESOURCES, type LocaleEntry } from "./locales";

// Dev-only pseudo locale (leak detector + growth probe).
export { PSEUDO_LOCALE, pseudoPostProcessor } from "./pseudo";

// The unmet-trigger-condition describer the PR page, the CLI and the Entry share.
export {
  describeUnmetCondition,
  type DescribableCondition,
  type UnmetConditionFormat,
} from "./trigger-conditions";

// Catalog re-export: completeness pins in consumer suites read it directly.
export { default as en } from "./locales/en.json";

// TranslationKey + the CustomTypeOptions augmentation (typed keys for every
// consumer) ride this re-export.
export { type TranslationKey } from "./types";
