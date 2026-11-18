import styles from "./Separator.module.scss";

/** A rule between two runs of rows. */
export function DropdownSeparator() {
  return <hr className={styles["separator"]} />;
}
