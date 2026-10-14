import { useQuery } from "@tanstack/react-query";
import { ProductActionIds } from "contract";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { apiFetch } from "../../../../data/apiFetch";
import { request } from "../../../../data/request";
import { changeLocale } from "../../../../i18n/I18nProvider";
import {
  findActiveLocaleIndex,
  isLanguageSelectionEnabled,
  listLocaleOptions,
} from "../../../../i18n/locale-options";
import { buildViewerQueryOptions } from "../../queries";
import {
  SignOutScopes,
  ViewerStates,
  type SignOutFlow,
  type SignOutScope,
  type ViewerState,
} from "../../types";

const LOGOUT_PATH = "/api/auth/logout";
const HOME_PATH = "/";
const SETTINGS_PATH = "/settings";

function selectLocale(id: string): void {
  void changeLocale(id);
}

/** Whether the server ended the session; a refused or unreachable route did not. */
async function postLogout(): Promise<boolean> {
  try {
    const response = await apiFetch(LOGOUT_PATH, {
      method: "POST",
      unauthorizedIsSignedOut: true,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Whether the server ended every session of the viewer, this one included. */
async function revokeSessions(): Promise<boolean> {
  try {
    await request(ProductActionIds.REVOKE_SESSIONS, {
      params: {},
      unauthorizedIsSignedOut: true,
    });
    return true;
  } catch {
    return false;
  }
}

const SIGN_OUT_REQUESTS: Record<SignOutScope, () => Promise<boolean>> = {
  [SignOutScopes.THIS_DEVICE]: postLogout,
  [SignOutScopes.EVERYWHERE]: revokeSessions,
};

const SIGN_OUT_CLOSED: SignOutFlow = {
  open: false,
  pending: undefined,
  failed: false,
};

/** One sign-out flow: a success leaves for Home, a refusal reports back into the confirm. */
async function runSignOut(
  scope: SignOutScope,
  setFlow: (flow: SignOutFlow) => void,
): Promise<void> {
  setFlow({ open: true, pending: scope, failed: false });
  const signedOut = await SIGN_OUT_REQUESTS[scope]();
  if (signedOut) {
    // A fresh document reads the signed-out state.
    window.location.assign(HOME_PATH);
    return;
  }
  setFlow({ open: true, pending: undefined, failed: true });
}

/** The viewer, the locale rows, and the flow actions the rows fire. */
export function useAccountMenuFacade() {
  const { i18n } = useTranslation();
  const [signOutFlow, setSignOutFlow] = useState<SignOutFlow>(SIGN_OUT_CLOSED);
  const viewerQuery = useQuery(buildViewerQueryOptions());
  const viewer: ViewerState = viewerQuery.data ?? {
    kind: ViewerStates.UNKNOWN,
  };
  const localeOptions = isLanguageSelectionEnabled() ? listLocaleOptions() : [];
  const activeLocaleIndex = findActiveLocaleIndex(localeOptions, i18n.language);

  function openSignOut(): void {
    setSignOutFlow({ open: true, pending: undefined, failed: false });
  }

  function cancelSignOut(): void {
    setSignOutFlow(SIGN_OUT_CLOSED);
  }

  function signOut(scope: SignOutScope): Promise<void> {
    return runSignOut(scope, setSignOutFlow);
  }

  function openSettings(): void {
    window.location.assign(SETTINGS_PATH);
  }

  return {
    viewer,
    viewerPending: viewerQuery.isPending,
    signOutFlow,
    localeOptions,
    activeLocaleIndex,
    openSignOut,
    cancelSignOut,
    signOut,
    openSettings,
    selectLocale,
  };
}
