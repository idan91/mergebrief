// API-token settings section (BRIEF-17 PR 4): mint form (name, installation
// picker from the live accessible set, expiry incl. no-expiry), the
// SHOWN-ONCE token display with its treat-as-password disclaimer, and the
// list with last-used + revoke. All flow state lives in the facade hook
// (`useTokenSettings`) — this component only wires it to the DOM.
import {
  useTokenSettings,
  ExpiryChoice,
  TOKEN_NAME_MAX,
} from "../../hooks/useTokenSettings";
import styles from "./TokenSettings.module.scss";

export interface TokenSettingsProps {
  /** Only fetch/render once the viewer is known to be signed in. */
  enabled: boolean;
}

function formatWhen(iso: string | null): string {
  if (iso === null) return "never";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function TokenSettings({ enabled }: TokenSettingsProps) {
  const state = useTokenSettings(enabled);

  if (!enabled) return null;

  return (
    <section
      aria-labelledby="token-settings-heading"
      className={styles["root"]}
    >
      <h2 id="token-settings-heading">API tokens</h2>
      <p className={styles["copy"]}>
        Tokens let the <code>mergebrief</code> CLI and agents read and submit
        through the API as you, bound to one organization each.
      </p>

      <form
        className={styles["mintForm"]}
        onSubmit={(event) => {
          event.preventDefault();
          state.submitMint();
        }}
      >
        <label className={styles["field"]}>
          <span>Token name</span>
          <input
            maxLength={TOKEN_NAME_MAX}
            onChange={(event) => state.setName(event.target.value)}
            placeholder="ci-reviewer"
            type="text"
            value={state.name}
          />
        </label>
        <label className={styles["field"]}>
          <span>Organization</span>
          <select
            onChange={(event) => state.setInstallationId(event.target.value)}
            value={state.installationId}
          >
            {state.installations.map((installation) => (
              <option key={installation.id} value={installation.id}>
                {installation.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles["field"]}>
          <span>Expires</span>
          <select
            onChange={(event) => {
              const value = event.target.value;
              const choice = Object.values(ExpiryChoice).find(
                (c) => c === value,
              );
              if (choice !== undefined) state.setExpiry(choice);
            }}
            value={state.expiry}
          >
            <option value={ExpiryChoice.THIRTY_DAYS}>30 days</option>
            <option value={ExpiryChoice.NINETY_DAYS}>90 days</option>
            <option value={ExpiryChoice.ONE_YEAR}>1 year</option>
            <option value={ExpiryChoice.NONE}>No expiry</option>
          </select>
        </label>
        <button
          className="btn primary"
          disabled={state.mintPending || state.mintBlockedReason !== null}
          type="submit"
        >
          {state.mintPending ? "Minting…" : "Mint token"}
        </button>
        {state.mintBlockedReason !== null && state.name !== "" ? (
          <p className={styles["hint"]}>{state.mintBlockedReason}</p>
        ) : null}
        {state.mintError !== null ? (
          <p className={styles["error"]} role="alert">
            {state.mintError}
          </p>
        ) : null}
      </form>

      {state.mintedToken !== null ? (
        <div aria-live="polite" className={styles["minted"]} role="status">
          <p className={styles["mintedHeading"]}>
            Copy your token now — it is shown exactly once and cannot be
            retrieved again.
          </p>
          <code className={styles["mintedValue"]}>
            {state.mintedToken.token}
          </code>
          <p className={styles["mintedDisclaimer"]}>
            Treat it like a password. The CLI stores it in plaintext in your
            home directory (<code>chmod 600</code>) — anyone with the token can
            act as you in{" "}
            <strong>
              {state.installations.find(
                (i) => i.id === state.mintedToken?.apiToken.installationId,
              )?.label ?? "its organization"}
            </strong>
            .
          </p>
          <button
            className="btn"
            onClick={state.dismissMintedToken}
            type="button"
          >
            I saved it — dismiss
          </button>
        </div>
      ) : null}

      <div className={styles["list"]}>
        {state.tokensError ? (
          <p className={styles["error"]} role="alert">
            Could not load your tokens.
          </p>
        ) : null}
        {state.tokens !== undefined && state.tokens.length === 0 ? (
          <p className={styles["empty"]}>No tokens yet.</p>
        ) : null}
        {(state.tokens ?? []).map((token) => (
          <div
            className={styles["row"]}
            data-revoked={token.revokedAt !== null}
            key={token.id}
          >
            <span className={styles["rowName"]}>{token.name}</span>
            <span className={styles["rowMeta"]}>
              {token.revokedAt !== null
                ? `revoked ${formatWhen(token.revokedAt)}`
                : `expires ${token.expiresAt === null ? "never" : formatWhen(token.expiresAt)} · last used ${formatWhen(token.lastUsedAt)}`}
            </span>
            {token.revokedAt === null ? (
              <button
                // Token-specific accessible name: multiple rows must be
                // distinguishable when navigating by buttons (codex PR4 R3).
                aria-label={`Revoke ${token.name}`}
                className={styles["revoke"]}
                disabled={state.revokePendingId === token.id}
                onClick={() => state.revoke(token.id)}
                type="button"
              >
                {state.revokePendingId === token.id ? "Revoking…" : "Revoke"}
              </button>
            ) : null}
          </div>
        ))}
        {state.revokeError !== null ? (
          <p className={styles["error"]} role="alert">
            {state.revokeError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
