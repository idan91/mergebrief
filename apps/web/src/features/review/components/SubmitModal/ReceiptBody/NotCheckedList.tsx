import { useTranslation } from "react-i18next";

import { RECEIPT_NOT_CHECKED_KEYS } from "../../../utils/receipt";
import styles from "./ReceiptBody.module.scss";

export function NotCheckedList() {
  const { t } = useTranslation();
  return (
    <ul className={styles["notChecked"]}>
      {RECEIPT_NOT_CHECKED_KEYS.map((key) => (
        <li key={key}>{t(key)}</li>
      ))}
    </ul>
  );
}
