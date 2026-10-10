import {
  Button,
  ButtonSizes,
  type ButtonVariant,
} from "@web/components/Button";
import { Kbd, KbdSizes } from "@web/components/Kbd";
import styles from "./StepButton.module.scss";

export interface StepButtonProps {
  label: string;
  /** The single key that does the same thing; its cap stays out of the name. */
  shortcut: string;
  variant: ButtonVariant;
  disabled: boolean;
  onClick: () => void;
}

export function StepButton({
  label,
  shortcut,
  variant,
  disabled,
  onClick,
}: StepButtonProps) {
  return (
    <Button
      aria-keyshortcuts={shortcut}
      className={styles["button"]}
      disabled={disabled}
      size={ButtonSizes.SM}
      variant={variant}
      onClick={onClick}
    >
      <span>{label}</span>
      <span aria-hidden="true" className={styles["key"]}>
        <Kbd size={KbdSizes.SM}>{shortcut}</Kbd>
      </span>
    </Button>
  );
}
