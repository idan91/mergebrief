import { useTranslation } from "react-i18next";

import {
  Button,
  ButtonVariants,
  type ButtonVariant,
} from "@web/components/Button";
import { Icon } from "@web/components/Icon";
import { IconNames } from "@web/components/Icon/types";
import styles from "./UrlBox.module.scss";
import { UrlBoxStates } from "./types";
import { useUrlBoxFacade } from "./useUrlBoxFacade";

export interface UrlBoxProps {
  /** Secondary where another action is the view's one primary. */
  generateVariant?: ButtonVariant;
}

/**
 * The quiet paste form: a link icon, the field, a slash hint that gives way
 * to the Generate button once text is entered. While submitting, the field
 * is replaced by one line of status and a thin accent sweep. The result of
 * a submit is a navigation; a refusal lands in the alert line below.
 */
export function UrlBox({
  generateVariant = ButtonVariants.PRIMARY,
}: UrlBoxProps) {
  const { t } = useTranslation();
  const facade = useUrlBoxFacade();
  const state = facade.submitting ? UrlBoxStates.PROGRESS : UrlBoxStates.IDLE;

  return (
    <div className={styles["box"]}>
      <form
        className={styles["form"]}
        data-state={state}
        onSubmit={(event) => {
          void facade.submit(event);
        }}
      >
        <Icon className={styles["icon"]} name={IconNames.LINK} />
        <input
          aria-busy={facade.submitting}
          aria-label={t("home.urlBox.ariaLabel")}
          autoComplete="off"
          className={styles["input"]}
          placeholder={t("home.urlBox.placeholder")}
          readOnly={facade.submitting}
          ref={facade.inputRef}
          type="url"
          value={facade.url}
          onChange={(event) => facade.setUrl(event.target.value)}
        />
        <span aria-live="polite" className={styles["progress"]} role="status">
          {facade.submitting ? t("home.urlBox.reading") : null}
        </span>
        <kbd aria-hidden="true" className={styles["hint"]}>
          /
        </kbd>
        <Button
          className={styles["submit"]}
          disabled={facade.submitting}
          type="submit"
          variant={generateVariant}
        >
          {t("home.urlBox.generate")}
        </Button>
      </form>
      {facade.error === null ? null : (
        <p className={styles["error"]} role="alert">
          {facade.error}
        </p>
      )}
    </div>
  );
}
