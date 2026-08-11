// API-token settings section. All flow state lives in `useTokenSettings` —
// this component only wires it to the DOM.
import { Trans, useTranslation } from "react-i18next";
import {
  useTokenSettings,
  ExpiryChoice,
  TOKEN_NAME_MAX,
} from "../../hooks/useTokenSettings";
import { formatDate, renderedLocale } from "../../../../i18n/locale";
import styles from "./TokenSettings.module.scss";

export interface TokenSettingsProps {
  /** Only fetch/render once the viewer is known to be signed in. */
  enabled: boolean;
}

function formatWhen(iso: string | null, locale: string, never: string): string {
  if (iso === null) return never;
  return formatDate(iso, locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Identifiers, never copy: a translated binary name or shell flag would
// be a broken instruction.
const CLI_BINARY = "mergebrief";
const CHMOD_COMMAND = "chmod 600";

export function TokenSettings({ enabled }: TokenSettingsProps) {
  const { i18n, t } = useTranslation();
  const state = useTokenSettings(enabled);
  const locale = renderedLocale(i18n.resolvedLanguage);

  if (!enabled) return null;

  return (
    <section
      aria-labelledby="token-settings-heading"
      className={styles["root"]}
    >
      <h2 id="token-settings-heading">{t("tokens.heading")}</h2>
      <p className={styles["copy"]}>
        <Trans
          components={[<code key="cli">{CLI_BINARY}</code>]}
          i18nKey="tokens.intro"
        />
      </p>

      <form
        className={styles["mintForm"]}
        onSubmit={(event) => {
          event.preventDefault();
          state.submitMint();
        }}
      >
        <label className={styles["field"]}>
          <span>{t("tokens.nameLabel")}</span>
          <input
            maxLength={TOKEN_NAME_MAX}
            onChange={(event) => state.setName(event.target.value)}
            placeholder={t("tokens.namePlaceholder")}
            type="text"
            value={state.name}
          />
        </label>
        <label className={styles["field"]}>
          <span>{t("tokens.organizationLabel")}</span>
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
          <span>{t("tokens.expiresLabel")}</span>
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
            <option value={ExpiryChoice.THIRTY_DAYS}>
              {t("tokens.expiry30")}
            </option>
            <option value={ExpiryChoice.NINETY_DAYS}>
              {t("tokens.expiry90")}
            </option>
            <option value={ExpiryChoice.ONE_YEAR}>
              {t("tokens.expiry365")}
            </option>
            <option value={ExpiryChoice.NONE}>{t("tokens.noExpiry")}</option>
          </select>
        </label>
        <button
          className="btn primary"
          disabled={state.mintPending || state.mintBlockedReason !== null}
          type="submit"
        >
          {state.mintPending ? t("tokens.minting") : t("tokens.mintToken")}
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
          <p className={styles["mintedHeading"]}>{t("tokens.mintedHeading")}</p>
          <code className={styles["mintedValue"]}>
            {state.mintedToken.token}
          </code>
          <p className={styles["mintedDisclaimer"]}>
            <Trans
              components={[
                <code key="chmod">{CHMOD_COMMAND}</code>,
                <strong key="org">
                  {state.installations.find(
                    (i) => i.id === state.mintedToken?.apiToken.installationId,
                  )?.label ?? t("tokens.itsOrganization")}
                </strong>,
              ]}
              i18nKey="tokens.disclaimer"
            />
          </p>
          <button
            className="btn"
            onClick={state.dismissMintedToken}
            type="button"
          >
            {t("tokens.dismissMinted")}
          </button>
        </div>
      ) : null}

      <div className={styles["list"]}>
        {state.tokensError ? (
          <p className={styles["error"]} role="alert">
            {t("tokens.loadFailed")}
          </p>
        ) : null}
        {state.tokens !== undefined && state.tokens.length === 0 ? (
          <p className={styles["empty"]}>{t("tokens.noTokens")}</p>
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
                ? t("tokens.rowRevoked", {
                    when: formatWhen(
                      token.revokedAt,
                      locale,
                      t("tokens.never"),
                    ),
                  })
                : t("tokens.rowActive", {
                    expires:
                      token.expiresAt === null
                        ? t("tokens.never")
                        : formatWhen(
                            token.expiresAt,
                            locale,
                            t("tokens.never"),
                          ),
                    lastUsed: formatWhen(
                      token.lastUsedAt,
                      locale,
                      t("tokens.never"),
                    ),
                  })}
            </span>
            {token.revokedAt === null ? (
              <button
                // Token-specific accessible name: multiple rows must be
                // distinguishable when navigating by buttons.
                aria-label={t("tokens.ariaLabelRevoke", { name: token.name })}
                className={styles["revoke"]}
                disabled={state.revokePendingId === token.id}
                onClick={() => state.revoke(token.id)}
                type="button"
              >
                {state.revokePendingId === token.id
                  ? t("tokens.revoking")
                  : t("tokens.revoke")}
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
