import type { createI18n } from "i18n";
import type { DefaultTheme } from "vitepress";

import type { AlertLabels } from "./alerts";
import { type SidebarLabels, SelfHostPhases } from "./pages/types";

type Translate = ReturnType<typeof createI18n>["t"];

type ChromeLabels = Pick<
  DefaultTheme.Config,
  | "outline"
  | "docFooter"
  | "darkModeSwitchLabel"
  | "lightModeSwitchTitle"
  | "darkModeSwitchTitle"
  | "sidebarMenuLabel"
  | "returnToTopLabel"
  | "skipToContentLabel"
  | "notFound"
>;

export interface SiteLabels {
  description: string;
  sidebar: SidebarLabels;
  chrome: ChromeLabels;
  search: NonNullable<DefaultTheme.LocalSearchOptions["translations"]>;
  copyCode: string;
  alerts: AlertLabels;
}

/** Every site string that is not a proper noun, from the `docsSite.*` catalog keys. */
export function readSiteLabels(t: Translate): SiteLabels {
  return {
    description: t("docsSite.description"),
    sidebar: {
      selfHosting: t("docsSite.sidebar.selfHosting"),
      repoConfig: t("docsSite.sidebar.repoConfig"),
      use: t("docsSite.sidebar.use"),
      reference: t("docsSite.sidebar.reference"),
      releases: t("docsSite.sidebar.releases"),
      selfHostPhases: {
        [SelfHostPhases.SET_UP]: t("docsSite.sidebar.setUp"),
        [SelfHostPhases.CONFIGURE]: t("docsSite.sidebar.configure"),
        [SelfHostPhases.SECURE]: t("docsSite.sidebar.secure"),
        [SelfHostPhases.OPERATE]: t("docsSite.sidebar.operate"),
      },
    },
    chrome: readChromeLabels(t),
    search: readSearchLabels(t),
    copyCode: t("docsSite.chrome.copyCode"),
    alerts: {
      note: t("docsSite.alerts.note"),
      tip: t("docsSite.alerts.tip"),
      important: t("docsSite.alerts.important"),
      warning: t("docsSite.alerts.warning"),
      caution: t("docsSite.alerts.caution"),
    },
  };
}

function readChromeLabels(t: Translate): ChromeLabels {
  return {
    outline: { label: t("docsSite.chrome.outlineLabel") },
    docFooter: {
      prev: t("docsSite.chrome.previousPage"),
      next: t("docsSite.chrome.nextPage"),
    },
    darkModeSwitchLabel: t("docsSite.chrome.appearanceLabel"),
    lightModeSwitchTitle: t("docsSite.chrome.switchToLight"),
    darkModeSwitchTitle: t("docsSite.chrome.switchToDark"),
    sidebarMenuLabel: t("docsSite.chrome.menuLabel"),
    returnToTopLabel: t("docsSite.chrome.returnToTop"),
    skipToContentLabel: t("docsSite.chrome.skipToContent"),
    notFound: {
      title: t("docsSite.notFound.title"),
      quote: t("docsSite.notFound.quote"),
      linkLabel: t("docsSite.notFound.linkLabel"),
      linkText: t("docsSite.notFound.linkText"),
    },
  };
}

function readSearchLabels(t: Translate): SiteLabels["search"] {
  return {
    button: {
      buttonText: t("docsSite.search.buttonText"),
      buttonAriaLabel: t("docsSite.search.buttonAriaLabel"),
    },
    modal: {
      displayDetails: t("docsSite.search.displayDetails"),
      resetButtonTitle: t("docsSite.search.resetButtonTitle"),
      backButtonTitle: t("docsSite.search.backButtonTitle"),
      noResultsText: t("docsSite.search.noResultsText"),
      footer: {
        selectText: t("docsSite.search.selectText"),
        selectKeyAriaLabel: t("docsSite.search.selectKeyAriaLabel"),
        navigateText: t("docsSite.search.navigateText"),
        navigateUpKeyAriaLabel: t("docsSite.search.navigateUpKeyAriaLabel"),
        navigateDownKeyAriaLabel: t("docsSite.search.navigateDownKeyAriaLabel"),
        closeText: t("docsSite.search.closeText"),
        closeKeyAriaLabel: t("docsSite.search.closeKeyAriaLabel"),
      },
    },
  };
}
