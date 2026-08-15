import { useTranslation } from "react-i18next";

import { RECEIPT_NOT_CHECKED_KEYS } from "../../../utils/receipt";
import styles from "./ReceiptAccordion.module.scss";

export function NotCheckedList() {
  const { t } = useTranslation();
  return (
    <div className={styles["notChecked"]}>
      {RECEIPT_NOT_CHECKED_KEYS.map((key) => (
        <span key={key}>{t(key)}</span>
      ))}
    </div>
  );
}
