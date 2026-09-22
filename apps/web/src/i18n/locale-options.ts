// The locale rows a language control offers, and the flag that withholds
// the control: the catalog and the locale machinery stay wired either way.
import { LOCALES, PSEUDO_LOCALE } from "i18n";

export interface LocaleOption {
  readonly id: string;
  readonly nativeName: string;
}

/** Off unless ENABLE_LANGUAGE_SELECTION is switched on. */
export function isLanguageSelectionEnabled(): boolean {
  const flag: unknown = import.meta.env["ENABLE_LANGUAGE_SELECTION"];
  return flag === "true" || flag === "1" || flag === true;
}

/** Registry rows plus the dev-only pseudo entry. */
export function listLocaleOptions(): LocaleOption[] {
  const options: LocaleOption[] = LOCALES.map((entry) => ({
    id: entry.id,
    nativeName: entry.nativeName,
  }));
  if (import.meta.env.DEV) {
    options.push({ id: PSEUDO_LOCALE, nativeName: "Pseudo (dev)" });
  }
  return options;
}

/** The row the runtime locale matches; a region tag falls back to its base. */
export function findActiveLocaleIndex(
  options: readonly LocaleOption[],
  language: string,
): number {
  return options.findIndex(
    (option) => option.id === language || option.id === language.split("-")[0],
  );
}
