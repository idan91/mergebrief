// Locale selection policy: explicit choice (localStorage) → browser default
// (navigator.language) → en. Pure + client-guarded so the SSR pass (which
// has neither) resolves to en without touching globals.
import { LOCALES, PSEUDO_LOCALE } from "i18n";

export const LOCALE_STORAGE_KEY = "mergebrief.locale";

export function renderedLocale(resolvedLanguage: string | undefined): string {
  return resolvedLanguage ?? "en";
}

export function formatDate(
  value: string | Date,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, options).format(date);
}

// A stored choice must be one the picker can mint: a registry id, or the
// pseudo locale in dev builds only — a prod visitor with a stale/hand-set
// "pseudo" (or garbage) key gets the browser default, never accent-padded
// UI or a nonsense <html lang>.
function isSelectableLocale(value: string): boolean {
  if (LOCALES.some((entry) => entry.id === value)) {
    return true;
  }
  return import.meta.env.DEV && value === PSEUDO_LOCALE;
}

export function resolveInitialLocale(): string {
  if (typeof window === "undefined") {
    return "en";
  }
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored !== null && isSelectableLocale(stored)) {
      return stored;
    }
  } catch {
    // Storage blocked (private mode) — fall through to the browser default.
  }
  // A BCP 47 tag the registry may not carry yet — the fallback chain
  // (locale → base-lang → en) absorbs it; pseudo can never arrive here.
  return window.navigator.language || "en";
}

export function persistLocale(locale: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage blocked — selection still applies for this session.
  }
}
