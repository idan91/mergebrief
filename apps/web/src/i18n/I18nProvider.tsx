// The app's i18next binding. ONE instance per module graph: the server
// renders en only (no per-request locale state), and the client resolves
// the persisted/browser locale before React mounts. Hydration cannot see
// divergent TEXT in v1: zero non-en catalogs ship and the pseudo locale is
// blocked outside dev builds (locale.ts), so a client locale differing from
// en still renders the en templates. Locale changes (the header picker) go
// through `changeLocale`, which persists the choice and stamps <html lang>.
import { createI18n } from "i18n";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import { persistLocale, resolveInitialLocale } from "./locale";

const i18n = createI18n({ locale: resolveInitialLocale() });

export interface I18nProviderProps {
  readonly children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  // Post-hydration stamp: SSR always serves lang="en"; a browser-resolved
  // locale corrects the attribute after mount (an attribute mutation, never
  // a markup mismatch).
  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, []);
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

/** The picker's one entry point: switch, persist, and stamp <html lang>. */
export async function changeLocale(locale: string): Promise<void> {
  await i18n.changeLanguage(locale);
  persistLocale(locale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}

/**
 * The active locale (the fallback chain may render a broader one).
 * NON-REACTIVE — a component rendering it must subscribe via
 * `useTranslation().i18n.language` instead.
 */
export function activeLocale(): string {
  return i18n.language;
}
