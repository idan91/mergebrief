import { createInstance, type i18n } from "i18next";
import { RESOURCES } from "./locales";
import { pseudoPostProcessor } from "./pseudo";

export interface CreateI18nOptions {
  /** Active locale. Unknown ids fall back through base-lang → en. */
  locale?: string;
}

/**
 * A ready instance with every shipped catalog baked in — no backend, no
 * detection: locale selection belongs to the caller (web header picker, CLI).
 * react-i18next binding stays in apps/web; this package never pulls React.
 */
export function createI18n(options: CreateI18nOptions = {}): i18n {
  const instance = createInstance();
  instance.use(pseudoPostProcessor);
  // Baked resources + initAsync:false make init synchronous — t() is
  // usable on the very next line, so the promise carries nothing.
  void instance.init({
    resources: RESOURCES,
    lng: options.locale ?? "en",
    fallbackLng: "en",
    returnNull: false,
    // React escapes rendered text itself and the CLI writes plain stderr;
    // i18next's HTML-entity escaping would corrupt both.
    interpolation: { escapeValue: false },
    postProcess: [pseudoPostProcessor.name],
    initAsync: false,
  });
  return instance;
}
