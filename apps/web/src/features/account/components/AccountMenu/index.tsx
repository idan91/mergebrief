import { PSEUDO_LOCALE } from "i18n";
import { useTranslation } from "react-i18next";

import { Button } from "@web/components/Button";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { IconButton } from "@web/components/IconButton";
import { Menu } from "@web/components/Menu";
import { ViewerStates } from "../../types";
import { SignOutModal } from "./SignOutModal";
import styles from "./AccountMenu.module.scss";
import { useAccountMenuFacade } from "./useAccountMenuFacade";

export interface AccountMenuProps {
  /** Present where a shortcuts modal exists; the row is omitted otherwise. */
  onOpenShortcuts?: (() => void) | undefined;
}

const SIGN_IN_PATH = "/api/auth/github";

/**
 * The person-anchored menu at the end of a Header: who is signed in,
 * Settings, Language, Keyboard shortcuts, and Sign out, which confirms in a
 * modal. Signed out, the slot holds a Sign in button instead; while the
 * viewer loads it holds nothing, and a failed read keeps the menu behind a
 * generic trigger.
 */
export function AccountMenu({ onOpenShortcuts }: AccountMenuProps) {
  const { t } = useTranslation();
  const facade = useAccountMenuFacade();
  const { viewer } = facade;

  if (viewer.kind === ViewerStates.UNKNOWN && facade.viewerPending) {
    return null;
  }
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
  const glyphClass = styles["icon"];

  return (
    <>
      <Menu placement="bottom-end">
        <Menu.Trigger>
          <IconButton
            autoWidth
            className={styles["trigger"]}
            label={label}
            size="md"
            variant="ghost"
          >
            {signedIn ? (
              <img alt="" className={styles["avatar"]} src={viewer.avatarUrl} />
            ) : (
              <Icon className={styles["person"]} name={IconNames.USER} />
            )}
            <Icon
              className={styles["caret"]}
              name={IconNames.CARET_DOWN}
              size={IconSizes.SM}
            />
          </IconButton>
        </Menu.Trigger>
        <Menu.Content>
          {signedIn && viewer.login !== null ? (
            <Menu.Label>
              {t("shell.accountMenu.signedInAs", { login: viewer.login })}
            </Menu.Label>
          ) : null}
          <Menu.Item
            glyph={
              <Icon
                className={glyphClass}
                name={IconNames.GEAR}
                size={IconSizes.MD}
              />
            }
            onSelect={facade.openSettings}
          >
            {t("shell.accountMenu.settings")}
          </Menu.Item>
          {facade.localeOptions.length > 0 ? (
            <Menu.Group label={t("shell.accountMenu.language")}>
              {facade.localeOptions.map((option, index) => (
                <Menu.Item
                  checked={index === facade.activeLocaleIndex}
                  key={option.id}
                  lang={option.id === PSEUDO_LOCALE ? undefined : option.id}
                  onSelect={() => facade.selectLocale(option.id)}
                >
                  {option.nativeName}
                </Menu.Item>
              ))}
            </Menu.Group>
          ) : null}
          {onOpenShortcuts === undefined ? null : (
            <Menu.Item
              glyph={
                <Icon
                  className={glyphClass}
                  name={IconNames.KEYBOARD}
                  size={IconSizes.MD}
                />
              }
              onSelect={onOpenShortcuts}
            >
              {t("shell.accountMenu.shortcuts")}
            </Menu.Item>
          )}
          <Menu.Item
            glyph={
              <Icon
                className={glyphClass}
                name={IconNames.SIGN_OUT}
                size={IconSizes.MD}
              />
            }
            onSelect={facade.openSignOut}
          >
            {t("shell.accountMenu.signOut")}
          </Menu.Item>
        </Menu.Content>
      </Menu>
      <SignOutModal
        cancel={facade.cancelSignOut}
        confirm={facade.signOut}
        flow={facade.signOutFlow}
      />
    </>
  );
}
