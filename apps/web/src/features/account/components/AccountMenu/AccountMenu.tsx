import { PSEUDO_LOCALE } from "i18n";
import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button/Button";
import { Menu } from "@web/components/Menu/Menu";
import { MenuRow } from "@web/components/Menu/MenuRow/MenuRow";
import CaretDownIcon from "@web/components/Menu/icons/caret-down.svg?react";
import PersonIcon from "@web/components/icons/person.svg?react";
import { ViewerStates } from "../../types";
import styles from "./AccountMenu.module.scss";
import GearIcon from "./icons/gear.svg?react";
import KeyboardIcon from "./icons/keyboard.svg?react";
import SignOutIcon from "./icons/sign-out.svg?react";
import { useAccountMenuFacade } from "./useAccountMenuFacade";

export interface AccountMenuProps {
  /** Present where a shortcuts modal exists; the row is omitted otherwise. */
  onOpenShortcuts?: (() => void) | undefined;
}

const SIGN_IN_PATH = "/api/auth/github";
const LANGUAGE_GROUP_LABEL_ID = "account-menu-language";

/**
 * The person-anchored menu at the end of a Header: who is signed in,
 * Settings, Language, Keyboard shortcuts, Sign out. Signed out, the slot
 * holds a Sign in button instead.
 */
export function AccountMenu({ onOpenShortcuts }: AccountMenuProps) {
  const { t } = useTranslation();
  const facade = useAccountMenuFacade();
  const { viewer } = facade;

  if (viewer.kind === ViewerStates.SIGNED_OUT) {
    return (
      <Button as="a" href={SIGN_IN_PATH} size="sm" variant="secondary">
        {t("shell.accountMenu.signIn")}
      </Button>
    );
  }

  const signedIn = viewer.kind === ViewerStates.SIGNED_IN;
  const label =
    signedIn && viewer.login !== null
      ? t("shell.accountMenu.ariaLabelTriggerSignedIn", { login: viewer.login })
      : t("shell.accountMenu.ariaLabelTrigger");
  const trigger = (
    <>
      {signedIn ? (
        <img alt="" className={styles["avatar"]} src={viewer.avatarUrl} />
      ) : (
        <PersonIcon aria-hidden="true" className={styles["person"]} />
      )}
      <CaretDownIcon aria-hidden="true" className={styles["caret"]} />
    </>
  );

  return (
    <Menu
      label={label}
      trigger={trigger}
      triggerAutoWidth
      triggerClassName={styles["trigger"]}
    >
      {signedIn && viewer.login !== null ? (
        <p className={styles["note"]} role="presentation">
          {t("shell.accountMenu.signedInAs", { login: viewer.login })}
        </p>
      ) : null}
      <MenuRow
        glyph={<GearIcon aria-hidden="true" className={styles["icon"]} />}
        onSelect={facade.openSettings}
      >
        {t("shell.accountMenu.settings")}
      </MenuRow>
      {facade.localeOptions.length > 0 ? (
        <div
          aria-labelledby={LANGUAGE_GROUP_LABEL_ID}
          className={styles["group"]}
          role="group"
        >
          <span className={styles["groupLabel"]} id={LANGUAGE_GROUP_LABEL_ID}>
            {t("shell.accountMenu.language")}
          </span>
          {facade.localeOptions.map((option, index) => (
            <MenuRow
              checked={index === facade.activeLocaleIndex}
              key={option.id}
              lang={option.id === PSEUDO_LOCALE ? undefined : option.id}
              onSelect={() => facade.selectLocale(option.id)}
            >
              {option.nativeName}
            </MenuRow>
          ))}
        </div>
      ) : null}
      {onOpenShortcuts === undefined ? null : (
        <MenuRow
          glyph={<KeyboardIcon aria-hidden="true" className={styles["icon"]} />}
          onSelect={onOpenShortcuts}
        >
          {t("shell.accountMenu.shortcuts")}
        </MenuRow>
      )}
      <MenuRow
        disabled={facade.signingOut}
        glyph={<SignOutIcon aria-hidden="true" className={styles["icon"]} />}
        keepOpen
        onSelect={() => {
          void facade.signOut();
        }}
      >
        {t("shell.accountMenu.signOut")}
      </MenuRow>
      {facade.signOutFailed ? (
        <p className={styles["error"]} role="alert">
          {t("shell.accountMenu.signOutFailed")}
        </p>
      ) : null}
    </Menu>
  );
}
