import { CopyButton } from "@web/components/CopyButton/CopyButton";
import type { BranchNameVariant } from "./types";
import styles from "./BranchName.module.scss";

export interface BranchNameProps {
  name: string;
  label: string;
  variant: BranchNameVariant;
}

export function BranchName({ name, label, variant }: BranchNameProps) {
  return (
    <span className={styles["branchName"]} data-variant={variant}>
      <span className={styles["name"]} title={name}>
        {name}
      </span>
      <CopyButton label={label} text={name} />
    </span>
  );
}
