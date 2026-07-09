// Facade hook for the token settings section (BRIEF-17 PR 4) — owns the
// whole flow state (`useReviewSubmit` is the template): the mint form, the
// SHOWN-ONCE minted token, the revoke mutation, and the deterministic-400
// mirrors (the server 400s an empty/over-long name — mirrored here so the
// form can never submit a payload the server deterministically rejects).
//
// SHOWN-ONCE (the section's one subtle beat): the minted token material
// lives in exactly ONE place — this hook's `mintedToken` state. Dismissing
// clears that state AND resets the mutation (react-query's `mutation.data`
// would otherwise silently retain the material) — after dismissal nothing in
// client state can re-render it.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError, ApiErrorKind } from "../../data/apiFetch";
import { installationsQueryOptions } from "../installations/queries";
import { mintToken, revokeToken, tokensQueryOptions } from "./queries";
import type { ApiTokenView, MintedToken } from "./types";

/** The server's name cap (mirrored — see the mint route's Zod schema). */
export const TOKEN_NAME_MAX = 100;

/** The expiry choices the form offers; `none` = no expiry. */
export const ExpiryChoice = {
  THIRTY_DAYS: "30",
  NINETY_DAYS: "90",
  ONE_YEAR: "365",
  NONE: "none",
} as const;
export type ExpiryChoice = (typeof ExpiryChoice)[keyof typeof ExpiryChoice];

export interface TokenSettingsState {
  /** The viewer's tokens, newest first (server order). */
  readonly tokens: readonly ApiTokenView[] | undefined;
  readonly tokensError: boolean;
  /** Accessible installations for the picker (live set via the switcher query). */
  readonly installations: readonly { id: string; label: string }[];
  // Mint form.
  readonly name: string;
  readonly setName: (value: string) => void;
  readonly installationId: string;
  readonly setInstallationId: (value: string) => void;
  readonly expiry: ExpiryChoice;
  readonly setExpiry: (value: ExpiryChoice) => void;
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
  const queryClient = useQueryClient();
  // `enabled` gates the fetches too (codex PR4 R1): a disabled mount must
  // never hit the protected /auth/* endpoints.
  const tokensQuery = useQuery({ ...tokensQueryOptions(), enabled });
  const installationsQuery = useQuery({
    ...installationsQueryOptions(),
    enabled,
  });

  const [name, setName] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [expiry, setExpiry] = useState<ExpiryChoice>(ExpiryChoice.NINETY_DAYS);
  const [mintedToken, setMintedToken] = useState<MintedToken | null>(null);

  const installations = (installationsQuery.data?.installations ?? []).map(
    (item) => ({ id: item.installationId, label: item.accountLogin }),
  );
  // The picker defaults to the session's current installation without
  // syncing props into state: an empty selection falls back at submit time.
  const currentInstallationId =
    installationsQuery.data?.currentInstallationId ?? "";
  const effectiveInstallationId =
    installationId === "" ? currentInstallationId : installationId;

  const minting = useMutation({
    mutationFn: mintToken,
    onSuccess: (minted) => {
      setMintedToken(minted);
      setName("");
      void queryClient.invalidateQueries({
        queryKey: tokensQueryOptions().queryKey,
      });
    },
  });

  const [revokePendingId, setRevokePendingId] = useState<string | null>(null);
  const revoking = useMutation({
    mutationFn: revokeToken,
    onSettled: () => {
      setRevokePendingId(null);
      void queryClient.invalidateQueries({
        queryKey: tokensQueryOptions().queryKey,
      });
    },
  });

  const trimmedName = name.trim();
  const mintBlockedReason =
    trimmedName.length === 0
      ? "Name the token before minting."
      : trimmedName.length > TOKEN_NAME_MAX
        ? `Token names are capped at ${TOKEN_NAME_MAX} characters.`
        : effectiveInstallationId === ""
          ? "Pick the organization the token is bound to."
          : null;

  const submitMint = (): void => {
    if (mintBlockedReason !== null || minting.isPending) return;
    minting.mutate({
      name: trimmedName,
      installationId: effectiveInstallationId,
      expiresInDays: expiry === ExpiryChoice.NONE ? null : Number(expiry),
    });
  };

  const dismissMintedToken = (): void => {
    setMintedToken(null);
    // The mutation result also holds the material — reset it so NOTHING in
    // client state can re-render the token after dismissal.
    minting.reset();
  };

  const mintError = minting.isError
    ? minting.error instanceof ApiError &&
      minting.error.kind === ApiErrorKind.FORBIDDEN
      ? "That organization is no longer accessible to you."
      : "Minting failed — nothing was created. Try again."
    : null;

  return {
    tokens: tokensQuery.data?.tokens,
    tokensError: tokensQuery.isError,
    installations,
    name,
    setName,
    installationId: effectiveInstallationId,
    setInstallationId,
    expiry,
    setExpiry,
    mintBlockedReason,
    mintPending: minting.isPending,
    mintError,
    submitMint,
    mintedToken,
    dismissMintedToken,
    revokePendingId,
    revokeError: revoking.isError
      ? "Revoking failed — the token is still active. Try again."
      : null,
    revoke: (tokenId) => {
      if (revoking.isPending) return;
      setRevokePendingId(tokenId);
      revoking.mutate(tokenId);
    },
  };
}
