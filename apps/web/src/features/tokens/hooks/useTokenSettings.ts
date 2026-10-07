// Keep shown-once token material in this hook's mintedToken state.
// Dismissal clears it and resets mutation.data so client state cannot redisplay it.
// Mirror deterministic server validation to avoid submitting rejected payloads.
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { buildTokensQueryOptions, mintToken, revokeToken } from "../queries";
import type { ApiTokenView, MintedToken, TokenScope } from "../types";

/** The server's name cap (mirrored, see the mint route's Zod schema). */
export const TOKEN_NAME_MAX = 100;

/** The expiry choices the form offers; `none` = no expiry. */
export const ExpiryChoices = {
  THIRTY_DAYS: "30",
  NINETY_DAYS: "90",
  ONE_YEAR: "365",
  NONE: "none",
} as const;
export type ExpiryChoice = (typeof ExpiryChoices)[keyof typeof ExpiryChoices];

/** No pre-selection: the scope a token carries is always a stated choice. */
export const SCOPE_UNCHOSEN = "";
export type ScopeChoice = TokenScope | typeof SCOPE_UNCHOSEN;

export interface TokenSettingsState {
  /** The viewer's tokens, newest first (server order). */
  readonly tokens: readonly ApiTokenView[] | undefined;
  readonly tokensError: boolean;
  // Mint form.
  readonly name: string;
  readonly setName: (value: string) => void;
  readonly expiry: ExpiryChoice;
  readonly setExpiry: (value: ExpiryChoice) => void;
  readonly scope: ScopeChoice;
  readonly setScope: (value: ScopeChoice) => void;
  /** The deterministic-400 mirror: why the form cannot submit, or null. */
  readonly mintBlockedReason: string | null;
  readonly mintPending: boolean;
  readonly mintError: string | null;
  readonly submitMint: () => void;
  // Shown-once result.
  readonly mintedToken: MintedToken | null;
  readonly dismissMintedToken: () => void;
  // Revoke.
  readonly revokePendingId: string | null;
  readonly revokeError: string | null;
  readonly revoke: (tokenId: string) => void;
}

export function useTokenSettings(enabled: boolean): TokenSettingsState {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  // `enabled` gates the fetches too: a disabled mount must never hit the
  // protected /api/auth/* endpoints.
  const tokensQuery = useQuery({ ...buildTokensQueryOptions(), enabled });

  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<ExpiryChoice>(ExpiryChoices.NINETY_DAYS);
  const [scope, setScope] = useState<ScopeChoice>(SCOPE_UNCHOSEN);
  const [mintedToken, setMintedToken] = useState<MintedToken | null>(null);

  const minting = useMutation({
    mutationFn: mintToken,
    onSuccess: (minted) => {
      setMintedToken(minted);
      setName("");
      void queryClient.invalidateQueries({
        queryKey: buildTokensQueryOptions().queryKey,
      });
    },
  });

  const [revokePendingId, setRevokePendingId] = useState<string | null>(null);
  const revoking = useMutation({
    mutationFn: revokeToken,
    onSettled: () => {
      setRevokePendingId(null);
      void queryClient.invalidateQueries({
        queryKey: buildTokensQueryOptions().queryKey,
      });
    },
  });

  const trimmedName = name.trim();
  const blockedReason = (): string | null => {
    if (trimmedName.length === 0) {
      return t("tokens.nameRequired");
    }
    if (trimmedName.length > TOKEN_NAME_MAX) {
      return t("tokens.nameTooLong", { max: TOKEN_NAME_MAX });
    }
    if (scope === SCOPE_UNCHOSEN) {
      return t("tokens.scopeRequired");
    }
    return null;
  };
  const mintBlockedReason = blockedReason();

  const submitMint = (): void => {
    if (mintBlockedReason !== null || minting.isPending) {
      return;
    }
    if (scope === SCOPE_UNCHOSEN) {
      return;
    }
    minting.mutate({
      name: trimmedName,
      scope,
      expiresInDays: expiry === ExpiryChoices.NONE ? null : Number(expiry),
    });
  };

  const dismissMintedToken = (): void => {
    setMintedToken(null);
    // The mutation result also holds the material, reset it so NOTHING in
    // client state can re-render the token after dismissal.
    minting.reset();
  };

  const mintError = minting.isError ? t("tokens.mintFailed") : null;

  return {
    tokens: tokensQuery.data?.tokens,
    tokensError: tokensQuery.isError,
    name,
    setName,
    expiry,
    setExpiry,
    scope,
    setScope,
    mintBlockedReason,
    mintPending: minting.isPending,
    mintError,
    submitMint,
    mintedToken,
    dismissMintedToken,
    revokePendingId,
    revokeError: revoking.isError ? t("tokens.revokeFailed") : null,
    revoke: (tokenId) => {
      if (revoking.isPending) {
        return;
      }
      setRevokePendingId(tokenId);
      revoking.mutate(tokenId);
    },
  };
}
