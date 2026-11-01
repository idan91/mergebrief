import { Icon } from "@web/components/Icon";
import { IconSizes, type IconName } from "@web/components/Icon/types";
import styles from "./TilePlaceholder.module.scss";

export interface TilePlaceholderProps {
  icon: IconName;
  label: string;
  /** The image behind the tile could not load. */
  failed?: boolean;
}

/**
 * A tile that shows what the item is without fetching it. Its label repeats
 * the tile's own name and stays silent, unless it says the image failed.
 */
export function TilePlaceholder({
  icon,
  label,
  failed = false,
}: TilePlaceholderProps) {
  return (
    <span
      className={styles["placeholder"]}
      data-state={failed ? "failed" : undefined}
      data-testid="media-tile-placeholder"
    >
      <Icon name={icon} size={IconSizes.LG} />
      <span aria-hidden={failed ? undefined : true} className={styles["label"]}>
        {label}
      </span>
    </span>
  );
}
