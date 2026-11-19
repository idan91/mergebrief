import { useNavigate } from "@tanstack/react-router";
import { RequestBounds } from "contract";
import { useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { generateBriefViaApi } from "../../../brief/queries";
import { briefErrorDetail } from "../../../brief/model";
import { useFocusOnKey } from "../../hooks/useFocusOnKey";

const FOCUS_KEY = "u";

/** The paste flow: the value, the submitting state, the curated error, and the focus shortcut. */
export function useUrlBoxFacade() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusOnKey(FOCUS_KEY, inputRef);

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
