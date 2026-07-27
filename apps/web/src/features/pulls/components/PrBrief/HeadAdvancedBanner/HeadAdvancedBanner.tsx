import styles from "./HeadAdvancedBanner.module.scss";

export interface HeadAdvancedBannerProps {
  onNavigate: () => void;
}

/** Offered, never forced — the viewer stays pinned until they choose. */
export function HeadAdvancedBanner({ onNavigate }: HeadAdvancedBannerProps) {
  return (
    <div className={styles["banner"]} role="status">
      <span>This pull request has new commits since this brief's span.</span>
      <button className="btn" onClick={onNavigate} type="button">
        Go to the newest revision
      </button>
    </div>
  );
}
