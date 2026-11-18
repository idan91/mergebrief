import { useNavigate } from "@tanstack/react-router";
import { RequestBounds } from "contract";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { generateBriefViaApi } from "../../../brief/queries";
import { briefErrorDetail } from "../../../brief/model";
import { isInsideOverlay } from "../../../../utils/overlay-target";
import { isTypingTarget } from "../../../../utils/typingTarget";
import { isSuppressedSingleKey } from "@web/utils/single-key-shortcuts";

const FOCUS_KEY = "u";

/** The paste flow: the value, the submitting state, the curated error, and the focus shortcut. */
export function useUrlBoxFacade() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function focusOnKey(event: KeyboardEvent): void {
      if (event.key !== FOCUS_KEY || event.metaKey || event.ctrlKey) {
        return;
      }
      if (isTypingTarget(event.target) || isInsideOverlay(event.target)) {
        return;
      }
      if (isSuppressedSingleKey(event)) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", focusOnKey);
    return () => window.removeEventListener("keydown", focusOnKey);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (url.trim() === "") {
      return;
    }
    if (url.length > RequestBounds.GENERATE_URL_LENGTH) {
      setError(t("home.urlBox.tooLong"));
      inputRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const accepted = await generateBriefViaApi(url);
      await navigate({
        to: "/repos/$repoId/pulls/$prNumber",
        params: {
          repoId: accepted.repoId,
          prNumber: String(accepted.prNumber),
        },
      });
    } catch (caught) {
      setError(briefErrorDetail(t, caught));
      setSubmitting(false);
      inputRef.current?.focus();
    }
  }

  return { inputRef, url, setUrl, submitting, error, submit };
}
