import en from "./locales/en.json";

/**
 * One row per shipped locale, the picker's curated list. A locale PR adds
 * `src/locales/<id>.json`, one row here, and one `RESOURCES` entry; the catalog
 * QA gates in this package's suite do the rest.
 */
export interface LocaleEntry {
  readonly id: string;
  readonly nativeName: string;
}

export const LOCALES = [
  { id: "en", nativeName: "English" },
] as const satisfies readonly LocaleEntry[];

/** Catalogs baked into `createI18n`; no backend, no loading states. */
export const RESOURCES = {
  en: { translation: en },
} as const;
