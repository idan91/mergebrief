import { BreakablePath } from "../../BreakablePath";
import { RowButton, RowButtonVariants } from "../../RowButton";
import { splitDirectoryAndFileName } from "./utils";
import styles from "./UnresolvedRow.module.scss";

export interface UnresolvedRowProps {
  /** A display path, with a line suffix for a comment. */
  path: string;
  /** The row's kind for assistive tech; its group heading shows it visually. */
  kindLabel?: string;
  /** The risk a flag raises at the path, set before it. */
  riskLabel?: string | undefined;
  /** The flag sits below the repo's attention bar: its label dims. */
  riskDeemphasized?: boolean;
  /** One quiet line under the path. */
  caption?: string | undefined;
  disabled?: boolean;
  onClick: () => void;
}

/** A gate dialog's unresolved item: a row that jumps to it. */
export function UnresolvedRow({
  path,
  kindLabel,
  riskLabel,
  riskDeemphasized = false,
  caption,
  disabled = false,
  onClick,
}: UnresolvedRowProps) {
  const { directory, fileName } = splitDirectoryAndFileName(path);

  return (
    <li>
      <RowButton
        disabled={disabled}
        variant={RowButtonVariants.ITEM}
        onClick={onClick}
      >
        {kindLabel === undefined ? null : (
          <>
            <span className="sr-only">{kindLabel},</span>{" "}
          </>
        )}
        {riskLabel === undefined ? null : (
          <span
            className={styles["risk"]}
            data-deemphasized={riskDeemphasized ? "" : undefined}
          >
            {riskLabel}
          </span>
        )}
        <span className={styles["path"]}>
          <span className={styles["directory"]}>
            <BreakablePath path={directory} />
          </span>
          <span className={styles["fileName"]}>{fileName}</span>
        </span>
        {caption === undefined ? null : (
          <span className={styles["caption"]}>{caption}</span>
        )}
      </RowButton>
    </li>
  );
}
