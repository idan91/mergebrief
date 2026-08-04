import { Drawer } from "@web/components/Drawer/Drawer";
import { SummaryPreview } from "@web/features/review";
import type { SessionSnapshot } from "@web/features/review/session";
import type { Brief } from "../../../types";
import styles from "./SummaryPreviewDrawer.module.scss";

export interface SummaryPreviewDrawerProps {
  brief: Brief;
  close: () => void;
  open: boolean;
  snapshot: SessionSnapshot;
}

/**
 * The in-page summary-preview drawer — the DB path's stand-in for the
 * standalone preview route, which only resolves LOCAL brief ids.
 */
export function SummaryPreviewDrawer({
  brief,
  close,
  open,
  snapshot,
}: SummaryPreviewDrawerProps) {
  return (
    <Drawer
      open={open}
      label="Summary preview"
      closeLabel="Close summary preview"
      close={close}
      asideClassName={styles["summaryDrawer"]}
    >
      <SummaryPreview brief={brief} snapshot={snapshot} />
    </Drawer>
  );
}
