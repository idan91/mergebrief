import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FailureBlock } from "@web/components/FailureBlock";
import { useAnnouncer } from "@web/hooks/useAnnouncer";
import type { ApiErrorCode } from "../../../../data/apiFetch";
import { FailureSides } from "../../types";
import { readFailureSide } from "../../utils";
import { focusMainContent } from "../utils";

export interface FailedInboxProps {
  code: ApiErrorCode;
  /** Ask again; resolves true once the list arrived, false when it failed again. */
  onRetry: () => Promise<boolean>;
}

/**
 * The list's failure in the personal line's slot: which side did not
 * answer, and Try again. A retry that fails again is announced anew and
 * keeps focus on the button; one that succeeds hands focus to the main
 * landmark, since the block that held it is gone.
 */
export function FailedInbox({ code, onRetry }: FailedInboxProps) {
  const { t } = useTranslation();
  const announcer = useAnnouncer();
  const [pending, setPending] = useState(false);
  const side = readFailureSide(code);
  const detail =
    side === FailureSides.GITHUB
      ? t("home.failed.github")
      : t("home.failed.server");

  async function retry(): Promise<void> {
    setPending(true);
    let arrived = false;
    try {
      arrived = await onRetry();
    } catch {
      arrived = false;
    } finally {
      setPending(false);
    }
    if (arrived) {
      focusMainContent();
      return;
    }
    announcer.announce(detail);
  }

  return (
    <>
      <FailureBlock
        detail={detail}
        heading={<h1>{t("home.failed.heading")}</h1>}
        pending={pending}
        retryLabel={t("home.failed.retry")}
        onRetry={() => {
          void retry();
        }}
      />
      <p
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {announcer.text}
      </p>
    </>
  );
}
