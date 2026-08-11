import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
  return (
    <Drawer
      open={open}
      label={t("brief.summaryPreviewDrawer.label")}
      closeLabel={t("brief.summaryPreviewDrawer.closeLabel")}
      close={close}
      asideClassName={styles["summaryDrawer"]}
    >
      <SummaryPreview brief={brief} snapshot={snapshot} />
    </Drawer>
  );
}
