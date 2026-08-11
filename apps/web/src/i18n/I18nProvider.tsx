// The app's i18next binding. ONE instance per module graph: the server
// renders en only (no per-request locale state), and the client resolves
// the persisted/browser locale before React mounts. Template TEXT cannot
// diverge in v1 (zero non-en catalogs ship, and dev-only pseudo is blocked
// in prod builds by locale.ts) — but values formatted by Intl inside a
// template still resolve against the client's locale and TIME ZONE, so a
// formatted date can differ from the server's render, exactly as the
// pre-i18n `toLocaleString` did. Locale changes (the header picker) go
// through `changeLocale`, which persists the choice and stamps <html lang>.
import { createI18n } from "i18n";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { I18nextProvider, setI18n } from "react-i18next";
import { persistLocale, resolveInitialLocale } from "./locale";

/**
 * THE instance — exported so tests build expectations from the same catalog
 * the app renders (never a second `createI18n`). Also registered as
 * react-i18next's default so hooks resolve it in bare-rendered subtrees.
 */
export const appI18n = createI18n({ locale: resolveInitialLocale() });
setI18n(appI18n);

export interface I18nProviderProps {
  readonly children: ReactNode;
}

export function I18nProvider({ children }: I18nProviderProps) {
  // Post-hydration stamp: SSR always serves lang="en"; a browser-resolved
  // locale corrects the attribute after mount (an attribute mutation, never
  // a markup mismatch).
  useEffect(() => {
    document.documentElement.lang = appI18n.language;
  }, []);
  return <I18nextProvider i18n={appI18n}>{children}</I18nextProvider>;
}

/** The picker's one entry point: switch, persist, and stamp <html lang>. */
export async function changeLocale(locale: string): Promise<void> {
  await appI18n.changeLanguage(locale);
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
  return appI18n.language;
}
