// The app's i18next binding. ONE instance per module graph: the server
// renders en only (no per-request locale state), and the client's first render
// does the same. The persisted/browser locale applies after hydration, so a
// future non-en catalog cannot make the server and hydration trees diverge.
import { createI18n } from "i18n";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { I18nextProvider, setI18n } from "react-i18next";
import { persistLocale, renderedLocale, resolveInitialLocale } from "./locale";

/**
 * THE instance — exported so tests build expectations from the same catalog
 * the app renders (never a second `createI18n`). Also registered as
 * react-i18next's default so hooks resolve it in bare-rendered subtrees.
 */
export const appI18n = createI18n({ locale: "en" });
setI18n(appI18n);

export interface I18nProviderProps {
  readonly children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  useEffect(() => {
    void applyLocale(resolveInitialLocale());
  }, []);
  return <I18nextProvider i18n={appI18n}>{children}</I18nextProvider>;
}

async function applyLocale(locale: string): Promise<void> {
  await appI18n.changeLanguage(locale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = renderedLocale(appI18n.resolvedLanguage);
  }
}

/** The picker's one entry point: switch, persist, and stamp <html lang>. */
export async function changeLocale(locale: string): Promise<void> {
  await applyLocale(locale);
  persistLocale(locale);
}

/**
 * The active locale (the fallback chain may render a broader one).
 * NON-REACTIVE — a component rendering it must subscribe via
 * `useTranslation().i18n.language` instead.
 */
export function activeLocale(): string {
  return appI18n.language;
}
