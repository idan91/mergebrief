// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useTranslation } from "react-i18next";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LOCALE_STORAGE_KEY } from "./locale";
import { activeLocale, changeLocale, I18nProvider } from "./I18nProvider";

function CatalogProbe() {
  const { t } = useTranslation();
  return <span>{t("errors.not-found")}</span>;
}

describe("I18nProvider", () => {
  beforeEach(() => {
    document.documentElement.lang = "";
  });

  afterEach(async () => {
    cleanup();
    window.localStorage.clear();
    await changeLocale("en");
  });

  it("stamps <html lang> with the rendered locale on mount", async () => {
    render(
      <I18nProvider>
        <CatalogProbe />
      </I18nProvider>,
    );
    await waitFor(() => expect(document.documentElement.lang).toBe("en"));
  });

  it("keeps the server render in English when a browser locale is stored", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "pseudo");
    const html = renderToString(
      <I18nProvider>
        <CatalogProbe />
      </I18nProvider>,
    );
    expect(html).toContain("not found");
    expect(html).not.toContain("ñóŧ fóúñð");
  });

  it("changeLocale switches, persists, and restamps lang", async () => {
    render(
      <I18nProvider>
        <CatalogProbe />
      </I18nProvider>,
    );
    await changeLocale("fr");
    expect(activeLocale()).toBe("fr");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr");
    expect(document.documentElement.lang).toBe("en");
    // No fr catalog ships, so the chain falls back to the en template.
    expect(screen.getByText("not found")).toBeDefined();
  });

  it("applies a stored locale after the provider mounts", async () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "pseudo");
    render(
      <I18nProvider>
        <CatalogProbe />
      </I18nProvider>,
    );
    expect(await screen.findByText(/ñóŧ fóúñð/)).toBeDefined();
    expect(document.documentElement.lang).toBe("en");
  });
});
