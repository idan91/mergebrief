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
const SESSIONS_PATH = "/api/auth/sessions";
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

/** Whether the server ended every session of the viewer, this one included. */
async function deleteSessions(): Promise<boolean> {
  try {
    const response = await apiFetch(SESSIONS_PATH, { method: "DELETE" });
    return response.ok;
  } catch {
    return false;
  }
}

/** One sign-out flow: a success leaves for Home, a refusal reports back. */
async function runSignOut(
  request: () => Promise<boolean>,
  setPending: (value: boolean) => void,
  setFailed: (value: boolean) => void,
): Promise<void> {
  setPending(true);
  setFailed(false);
  const signedOut = await request();
  if (signedOut) {
    // A fresh document reads the signed-out state.
    window.location.assign(HOME_PATH);
    return;
  }
  setPending(false);
  setFailed(true);
}

/** The viewer, the locale rows, and the flow actions the rows fire. */
export function useAccountMenuFacade() {
  const { i18n } = useTranslation();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [signingOutEverywhere, setSigningOutEverywhere] = useState(false);
  const [signOutEverywhereFailed, setSignOutEverywhereFailed] = useState(false);
  const viewerQuery = useQuery(buildViewerQueryOptions());
  const viewer: ViewerState = viewerQuery.data ?? {
    kind: ViewerStates.UNKNOWN,
  };
  const localeOptions = isLanguageSelectionEnabled() ? listLocaleOptions() : [];
  const activeLocaleIndex = findActiveLocaleIndex(localeOptions, i18n.language);

  function signOut(): Promise<void> {
    return runSignOut(postLogout, setSigningOut, setSignOutFailed);
  }

  function signOutEverywhere(): Promise<void> {
    return runSignOut(
      deleteSessions,
      setSigningOutEverywhere,
      setSignOutEverywhereFailed,
    );
  }

  function openSettings(): void {
    window.location.assign(SETTINGS_PATH);
  }

  return {
    viewer,
    viewerPending: viewerQuery.isPending,
    signingOut,
    signOutFailed,
    signingOutEverywhere,
    signOutEverywhereFailed,
    localeOptions,
    activeLocaleIndex,
    signOut,
    signOutEverywhere,
    openSettings,
    selectLocale,
  };
}
