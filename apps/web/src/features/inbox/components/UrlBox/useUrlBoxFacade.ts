import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { generateBriefViaApi } from "../../../brief/queries";
import { briefErrorDetail } from "../../../brief/model";
import { isInsideOverlay } from "../../../../utils/overlay-target";
import { isTypingTarget } from "../../../../utils/typingTarget";

const FOCUS_KEY = "/";

/** The paste flow: the value, the submitting state, the curated error, and the slash shortcut. */
export function useUrlBoxFacade() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function focusOnSlash(event: KeyboardEvent): void {
      if (event.key !== FOCUS_KEY || event.metaKey || event.ctrlKey) {
        return;
      }
      if (isTypingTarget(event.target) || isInsideOverlay(event.target)) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", focusOnSlash);
    return () => window.removeEventListener("keydown", focusOnSlash);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (url.trim() === "") {
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
