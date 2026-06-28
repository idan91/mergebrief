import styles from "./Footer.module.scss";

export function Footer() {
  return (
    <footer className={styles["footer"]}>
      Live TanStack Start rewrite · local brief fetched from
      tools/categorizer/out. No AI-authored review prose ships from this
      surface.
    </footer>
  );
}
