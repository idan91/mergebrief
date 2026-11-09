// API-token settings section. All flow state lives in `useTokenSettings` -
// this component only wires it to the DOM.
import { useRef } from "react";
import { Trans, useTranslation } from "react-i18next";
import { RequestBounds } from "contract";
import { useTokenSettings, SCOPE_UNCHOSEN } from "../../hooks/useTokenSettings";
import { Button, ButtonVariants } from "@web/components/Button";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import { renderedLocale } from "../../../../i18n/locale";
import { SCOPE_LABEL_KEY, SCOPE_ORDER } from "./consts";
import { CreatedToken } from "./CreatedToken";
import { TokenRow } from "./TokenRow";
import styles from "./TokenSettings.module.scss";
import { ExpiryChoices } from "../../types";
import { describeToken, parseExpiryChoice, parseScopeChoice } from "./utils";

export interface TokenSettingsProps {
  /** Only fetch/render once the viewer is known to be signed in. */
  enabled: boolean;
  /** A rail beside the section names it; the heading then only reaches assistive tech. */
  namedByRail?: boolean;
}

// An identifier, never copy: a translated binary name would be a broken instruction.
const CLI_BINARY = "mergebrief";
const HEADING_ID = "token-settings-heading";
const SCOPE_HINT_ID = "token-scope-hint";
const CREATE_BLOCKED_ID = "token-create-blocked";

export function TokenSettings({
  enabled,
  namedByRail = false,
}: TokenSettingsProps) {
  const { i18n, t } = useTranslation();
  const state = useTokenSettings(enabled);
  const locale = renderedLocale(i18n.resolvedLanguage);
  const nameRef = useRef<HTMLInputElement | null>(null);

  if (!enabled) {
    return null;
  }

  function finishWithToken() {
    state.dismissMintedToken();
    nameRef.current?.focus();
  }

  const blockedReasonShown =
    state.mintBlockedReason !== null && state.name !== "";
  const scopeDescribedBy = blockedReasonShown
    ? `${SCOPE_HINT_ID} ${CREATE_BLOCKED_ID}`
    : SCOPE_HINT_ID;
  const createHeld = state.mintPending || state.mintBlockedReason !== null;
  const listEmpty = state.tokens !== undefined && state.tokens.length === 0;
  const hasTokens = state.tokens !== undefined && state.tokens.length > 0;
  const revokeInFlight = state.revokePendingId !== null;
  const createLabel = state.mintPending
    ? t("tokens.creating")
    : t("tokens.createToken");
  const tokenRows = (state.tokens ?? []).map((token) => ({
    id: token.id,
    name: token.name,
    meta: describeToken(t, locale, token),
    revoked: token.revokedAt !== undefined,
    revokedHere: state.revokedHereId === token.id,
    revoking: state.revokePendingId === token.id,
  }));
  const heading = t("tokens.heading");
  // The shown-once Copy is the view's one primary while the token is up.
  const createVariant =
    state.mintedToken === null
      ? ButtonVariants.PRIMARY
      : ButtonVariants.SECONDARY;

  return (
    <section aria-labelledby={HEADING_ID} className={styles["root"]}>
      {namedByRail ? (
        <ScreenReaderOnly as="h2" id={HEADING_ID}>
          {heading}
        </ScreenReaderOnly>
      ) : (
        <h2 className={styles["heading"]} id={HEADING_ID}>
          {heading}
        </h2>
      )}
      <p className={styles["copy"]}>
        <Trans
          components={[<code key="cli">{CLI_BINARY}</code>]}
          i18nKey="tokens.intro"
        />
      </p>

      <form
        className={styles["createForm"]}
        onSubmit={(event) => {
          event.preventDefault();
          state.submitMint();
        }}
      >
        <label className={styles["field"]}>
          <span>{t("tokens.nameLabel")}</span>
          <input
            maxLength={RequestBounds.TOKEN_NAME_LENGTH}
            onChange={(event) => state.setName(event.target.value)}
            placeholder={t("tokens.namePlaceholder")}
            ref={nameRef}
            type="text"
            value={state.name}
          />
        </label>
        <label className={styles["field"]}>
          <span>{t("tokens.scopeLabel")}</span>
          <span className={styles["selectWrap"]}>
            {/* No pre-selection: a token's reach is stated, never inherited -
                the server refuses a create that names none. */}
            <select
              aria-describedby={scopeDescribedBy}
              onChange={(event) => {
                const choice = parseScopeChoice(event.target.value);
                if (choice !== undefined) {
                  state.setScope(choice);
                }
              }}
              required
              value={state.scope}
            >
              <option value={SCOPE_UNCHOSEN}>{t("tokens.scopeChoose")}</option>
              {SCOPE_ORDER.map((scope) => (
                <option key={scope} value={scope}>
                  {t(SCOPE_LABEL_KEY[scope])}
                </option>
              ))}
            </select>
            <Icon name={IconNames.CARET_DOWN} size={IconSizes.SM} />
          </span>
        </label>
        <label className={styles["field"]}>
          <span>{t("tokens.expiresLabel")}</span>
          <span className={styles["selectWrap"]}>
            <select
              onChange={(event) => {
                const choice = parseExpiryChoice(event.target.value);
                if (choice !== undefined) {
                  state.setExpiry(choice);
                }
              }}
              value={state.expiry}
            >
              <option value={ExpiryChoices.THIRTY_DAYS}>
                {t("tokens.expiry30")}
              </option>
              <option value={ExpiryChoices.NINETY_DAYS}>
                {t("tokens.expiry90")}
              </option>
              <option value={ExpiryChoices.ONE_YEAR}>
                {t("tokens.expiry365")}
              </option>
              <option value={ExpiryChoices.NONE}>{t("tokens.noExpiry")}</option>
            </select>
            <Icon name={IconNames.CARET_DOWN} size={IconSizes.SM} />
          </span>
        </label>
        <Button
          className={styles["create"]}
          disabled={createHeld}
          loading={state.mintPending}
          type="submit"
          variant={createVariant}
        >
          {createLabel}
        </Button>
        <p className={styles["hint"]} id={SCOPE_HINT_ID}>
          {t("tokens.scopeHint")}
        </p>
        {blockedReasonShown ? (
          <p className={styles["hint"]} id={CREATE_BLOCKED_ID}>
            {state.mintBlockedReason}
          </p>
        ) : null}
        {state.mintError !== null ? (
          <p className={styles["error"]} role="alert">
            {state.mintError}
          </p>
        ) : null}
      </form>

      {state.mintedToken !== null ? (
        <CreatedToken
          dismiss={finishWithToken}
          key={state.mintedToken.apiToken.id}
          token={state.mintedToken.token}
        />
      ) : null}

      {state.tokensError ? (
        <p className={styles["error"]} role="alert">
          {t("tokens.loadFailed")}
        </p>
      ) : null}
      {listEmpty ? (
        <p className={styles["empty"]}>{t("tokens.noTokens")}</p>
      ) : null}
      {hasTokens ? (
        <ul className={styles["list"]}>
          {tokenRows.map((row) => (
            <TokenRow
              key={row.id}
              meta={row.meta}
              name={row.name}
              revoke={() => state.revoke(row.id)}
              revokeInFlight={revokeInFlight}
              revoked={row.revoked}
              revokedHere={row.revokedHere}
              revoking={row.revoking}
            />
          ))}
        </ul>
      ) : null}
      {hasTokens ? (
        <span className="sr-only" role="status">
          {state.revokeAnnouncement}
        </span>
      ) : null}
      {state.revokeError !== null ? (
        <p className={styles["error"]} role="alert">
          {state.revokeError}
        </p>
      ) : null}
    </section>
  );
}
