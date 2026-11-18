import { useTranslation } from "react-i18next";
import { MODE_LABEL_KEYS, type EditorMode } from "./good";

export interface ModeTabProps {
  mode: EditorMode;
}

export function ModeTab({ mode }: ModeTabProps) {
  const { t } = useTranslation();
  const label = t(MODE_LABEL_KEYS[mode]);
  return <span data-mode={mode}>{label}</span>;
}
