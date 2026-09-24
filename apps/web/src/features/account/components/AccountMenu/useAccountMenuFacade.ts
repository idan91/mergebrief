import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { apiFetch } from "../../../../data/apiFetch";
import { changeLocale } from "../../../../i18n/I18nProvider";
import {
  findActiveLocaleIndex,
  isLanguageSelectionEnabled,
  listLocaleOptions,
} from "../../../../i18n/locale-options";
import { buildViewerQueryOptions } from "../../queries";
import { ViewerStates, type ViewerState } from "../../types";

const LOGOUT_PATH = "/api/auth/logout";
const HOME_PATH = "/";
const SETTINGS_PATH = "/settings";

function selectLocale(id: string): void {
  void changeLocale(id);
}

/** Whether the server ended the session; a refused or unreachable route did not. */
async function postLogout(): Promise<boolean> {
  try {
    const response = await apiFetch(LOGOUT_PATH, { method: "POST" });
    return response.ok;
  } catch {
    return false;
  }
}

/** The viewer, the locale rows, and the flow actions the rows fire. */
export function useAccountMenuFacade() {
  const { i18n } = useTranslation();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const viewerQuery = useQuery(buildViewerQueryOptions());
  const viewer: ViewerState = viewerQuery.data ?? {
    kind: ViewerStates.UNKNOWN,
  };
  const localeOptions = isLanguageSelectionEnabled() ? listLocaleOptions() : [];
  const activeLocaleIndex = findActiveLocaleIndex(localeOptions, i18n.language);

  async function signOut(): Promise<void> {
    setSigningOut(true);
    setSignOutFailed(false);
    const signedOut = await postLogout();
    if (signedOut) {
      // A fresh document reads the signed-out state.
      window.location.assign(HOME_PATH);
      return;
    }
    setSigningOut(false);
    setSignOutFailed(true);
  }

  function openSettings(): void {
    window.location.assign(SETTINGS_PATH);
  }

  return {
    viewer,
    viewerPending: viewerQuery.isPending,
    signingOut,
    signOutFailed,
    localeOptions,
    activeLocaleIndex,
    signOut,
    openSettings,
    selectLocale,
  };
}
