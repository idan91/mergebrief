import type { CoreRule, CoreState } from "./types";

export const ALERT_TITLE_RULE_NAME = "docs-site-alert-titles";

/** The token VitePress's GitHub-alert plugin opens an alert with. */
const ALERT_OPEN_TOKEN = "github_alert_open";

/** The title each GitHub alert takes on the site, as GitHub itself shows it. */
export interface AlertLabels {
  note: string;
  tip: string;
  important: string;
  warning: string;
  caution: string;
}

interface AlertMeta {
  type: string;
  title: string;
}

function isAlertMeta(meta: unknown): meta is AlertMeta {
  if (typeof meta !== "object" || meta === null) {
    return false;
  }

  return (
    "type" in meta &&
    typeof meta.type === "string" &&
    "title" in meta &&
    typeof meta.title === "string"
  );
}

/**
 * VitePress 1.6 never hands its container labels to its alert plugin, so an alert without a
 * title of its own reads `WARNING`. This gives it the catalog's label; an author's title stays.
 */
export function createAlertTitleRule(labels: AlertLabels): CoreRule {
  const titles = new Map(Object.entries(labels));

  return (state: CoreState) => {
    for (const token of state.tokens) {
      const meta: unknown = token.meta;
      if (token.type !== ALERT_OPEN_TOKEN || !isAlertMeta(meta)) {
        continue;
      }

      const label = titles.get(meta.type);
      const untitled = meta.title === meta.type.toUpperCase();
      if (label !== undefined && untitled) {
        token.meta = { type: meta.type, title: label };
      }
    }
  };
}
