import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import {
  ATTACHMENT_MAX_BYTES,
  AttachmentMediaTypes,
  buildOperationPath,
  ProductActionIds,
  type AttachmentMediaType,
} from "contract";

import {
  ApiError,
  ApiErrorCodes,
  apiFetch,
  errorFromResponse,
  isSignInRequired,
} from "@web/data/apiFetch";
import type { Result } from "types/utils";
import { useAttachmentScope } from "../Markdown/context";
import { parseUploadAttachmentResponse } from "./schemas";
import { AttachDisabledReasons, type AttachDisabledReason } from "./types";
import {
  buildImageMarkdown,
  buildUploadPlaceholders,
  insertPlaceholder,
  parseRetryAfterSeconds,
  replacePlaceholder,
  type TextEdit,
} from "./utils";

export interface AttachmentUploadArgs {
  /** Applies an edit at the caret; declines while read-only. */
  readonly applyEdit: (
    edit: (text: string, start: number, end: number) => TextEdit | null,
  ) => boolean;
  /** Applies an edit that does not depend on the caret; false once the instance is gone. */
  readonly applyValueEdit: (edit: (text: string) => TextEdit | null) => boolean;
  readonly readOnly: boolean;
  /** The page live region with its toast: every failure. */
  readonly announce?: ((message: string) => void) | undefined;
  /** The live region alone: the in-flight start, which the placeholder already shows. */
  readonly announceQuietly?: ((message: string) => void) | undefined;
  /** The consumer's inline error surface. */
  readonly onAttachError?: ((copy: string) => void) | undefined;
}

export interface AttachmentUpload {
  readonly disabledReason: AttachDisabledReason | undefined;
  readonly inFlight: number;
  /** Uploads every image among the files; other files are ignored. */
  readonly attach: (files: Iterable<File>) => void;
}

interface UploadFailure {
  readonly cause: unknown;
  /** Set on any HTTP refusal; only an attachment-limit 429 acts on it. */
  readonly retryAfterMs?: number;
}

/** One drop or paste; its files share one limit message. */
interface UploadBatch {
  limitReported: boolean;
}

/** Long enough for the cap on a slow link; a hung upload must not hold the queue. */
const UPLOAD_TIMEOUT_MS = 120_000;

const RETRY_AFTER_HEADER = "retry-after";
const MS_PER_SECOND = 1000;
/** The wait after a 429 whose retry-after is missing or unreadable. */
const LIMIT_FALLBACK_MS = 60_000;
/** The longest wait one 429 can impose; the next request after it asks again. */
const LIMIT_CEILING_MS = 3_600_000;

const UPLOAD_MEDIA_TYPES: ReadonlySet<string> = new Set(
  Object.values(AttachmentMediaTypes),
);

/** Repos whose push the server refused this session; the control stays off. */
const refusedRepoIds = new Set<string>();
/** Repos the App may not write to; the same off state with its own reason. */
const unwritableRepoIds = new Set<string>();
/** Repos the server answered 429 for, with the epoch ms their wait ends. */
const limitedUntilByRepoId = new Map<string, number>();
/** Every placeholder an upload still owns, whichever composer started it. */
const inFlightPlaceholders = new Set<string>();
/**
 * Settles whose composer had unmounted by the time the upload landed. The
 * text that holds the placeholder may live on in a store or a draft, so the
 * next instance that finds one of these in its value takes the swap over.
 */
const orphanSettles = new Map<string, string>();
const orphanListeners = new Set<() => void>();

function recordOrphanSettle(placeholder: string, replacement: string): void {
  orphanSettles.set(placeholder, replacement);
  for (const listener of orphanListeners) {
    listener();
  }
}

export function subscribeOrphanSettles(listener: () => void): () => void {
  orphanListeners.add(listener);
  return () => {
    orphanListeners.delete(listener);
  };
}

/** Applies every orphan settle the text holds, in one edit; null when it holds none. */
export function adoptOrphanSettles(text: string): TextEdit | null {
  let edit: TextEdit | null = null;
  for (const [placeholder, replacement] of orphanSettles) {
    const next = replacePlaceholder(
      edit?.text ?? text,
      placeholder,
      replacement,
    );
    if (next !== null) {
      orphanSettles.delete(placeholder);
      inFlightPlaceholders.delete(placeholder);
      edit = next;
    }
  }
  return edit;
}
/**
 * One upload at a time per repo, across every composer on the page: each
 * commit moves the same branch head, and the server settles only one lost
 * race, so a batch sent at once would drop all but two.
 */
const uploadQueues = new Map<string, Promise<void>>();

export function resetAttachmentUploadState(): void {
  refusedRepoIds.clear();
  unwritableRepoIds.clear();
  limitedUntilByRepoId.clear();
  inFlightPlaceholders.clear();
  orphanSettles.clear();
  uploadQueues.clear();
}

function enqueueUpload(repoId: string, run: () => Promise<void>): void {
  const previous = uploadQueues.get(repoId) ?? Promise.resolve();
  const next = previous.then(run, run);
  uploadQueues.set(
    repoId,
    next.catch(() => undefined),
  );
}

function isAttachmentMediaType(value: string): value is AttachmentMediaType {
  return UPLOAD_MEDIA_TYPES.has(value);
}

function buildUploadPath(repoId: string, prNumber: number): string {
  return buildOperationPath(ProductActionIds.UPLOAD_ATTACHMENT, {
    repoId,
    prNumber,
  });
}

function failureCopy(t: TFunction, error: unknown): string {
  if (!(error instanceof ApiError)) {
    return t("shell.attach.failed");
  }
  if (error.code === ApiErrorCodes.ATTACHMENTS_DISABLED) {
    return t("shell.attach.disabledByRule");
  }
  if (error.code === ApiErrorCodes.GITHUB_PERMISSION) {
    return t("shell.attach.appPermission");
  }
  if (error.code === ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE) {
    return t("shell.attach.unsupportedType");
  }
  if (error.code === ApiErrorCodes.REQUEST_TOO_LARGE) {
    return t("shell.attach.tooLarge");
  }
  if (error.code === ApiErrorCodes.ATTACHMENT_LIMIT_REACHED) {
    return t("shell.attach.limitReached");
  }
  if (isSignInRequired(error.code)) {
    return t("shell.attach.unauthorized");
  }
  return t("shell.attach.failed");
}

function readRetryAfterMs(headers: Headers): number {
  const header = headers.get(RETRY_AFTER_HEADER);
  if (header === null) {
    return LIMIT_FALLBACK_MS;
  }
  const parsed = parseRetryAfterSeconds(header, Date.now());
  if (!parsed.ok) {
    return LIMIT_FALLBACK_MS;
  }

  const waitMs = parsed.value * MS_PER_SECOND;
  const cappedWaitMs = Math.min(waitMs, LIMIT_CEILING_MS);
  return cappedWaitMs;
}

function isRepoLimited(repoId: string): boolean {
  const limitedUntil = limitedUntilByRepoId.get(repoId);
  if (limitedUntil === undefined) {
    return false;
  }
  const waitRunning = Date.now() < limitedUntil;
  if (waitRunning) {
    return true;
  }
  limitedUntilByRepoId.delete(repoId);
  return false;
}

/** Remembers a refusal that holds for the repo, so later uploads skip the request. */
function recordRepoRefusal(repoId: string, failure: UploadFailure): void {
  const { cause } = failure;
  if (!(cause instanceof ApiError)) {
    return;
  }
  if (cause.code === ApiErrorCodes.ATTACHMENTS_DISABLED) {
    refusedRepoIds.add(repoId);
  } else if (cause.code === ApiErrorCodes.GITHUB_PERMISSION) {
    unwritableRepoIds.add(repoId);
  } else if (cause.code === ApiErrorCodes.ATTACHMENT_LIMIT_REACHED) {
    const retryAfterMs = failure.retryAfterMs ?? LIMIT_FALLBACK_MS;
    const limitedUntil = Date.now() + retryAfterMs;
    limitedUntilByRepoId.set(repoId, limitedUntil);
  }
}

async function uploadImage(
  path: string,
  file: File,
): Promise<Result<string, UploadFailure>> {
  try {
    const response = await apiFetch(path, {
      method: "POST",
      headers: { "content-type": file.type },
      body: file,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!response.ok) {
      const retryAfterMs = readRetryAfterMs(response.headers);
      const cause = await errorFromResponse(response, path);
      return { ok: false, error: { cause, retryAfterMs } };
    }
    const receipt = parseUploadAttachmentResponse(await response.json());
    if (!receipt.ok) {
      const cause = new Error("upload receipt carried no url");
      return { ok: false, error: { cause } };
    }
    return { ok: true, value: receipt.value.url };
  } catch (error) {
    return { ok: false, error: { cause: error } };
  }
}

/**
 * One upload per image: a placeholder at the caret while the bytes go up,
 * swapped for the image line on 201 and removed on failure. The cap and
 * the type allowlist mirror the route, so a refused file never leaves the
 * browser. The composer's text is read through the edit callbacks at
 * completion, never from a closure, so typing meanwhile is kept.
 */
export function useAttachmentUpload({
  applyEdit,
  applyValueEdit,
  readOnly,
  announce,
  announceQuietly,
  onAttachError,
}: AttachmentUploadArgs): AttachmentUpload {
  const { t } = useTranslation();
  const scope = useAttachmentScope();
  const [inFlight, setInFlight] = useState(0);

  let disabledReason: AttachDisabledReason | undefined;
  if (scope === undefined) {
    disabledReason = AttachDisabledReasons.NO_SCOPE;
  } else if (!scope.installed) {
    disabledReason = AttachDisabledReasons.NOT_INSTALLED;
  } else if (refusedRepoIds.has(scope.repoId)) {
    disabledReason = AttachDisabledReasons.REFUSED;
  } else if (unwritableRepoIds.has(scope.repoId)) {
    disabledReason = AttachDisabledReasons.NO_PERMISSION;
  }

  const fail = (copy: string) => {
    onAttachError?.(copy);
    announce?.(copy);
  };

  // The name stays taken until the swap has landed somewhere: an orphan
  // adopted later must not find a newer upload's line under the same name.
  const settle = (placeholder: string, replacement: string) => {
    const applied = applyValueEdit((text) =>
      replacePlaceholder(text, placeholder, replacement),
    );
    if (applied) {
      inFlightPlaceholders.delete(placeholder);
      return;
    }
    recordOrphanSettle(placeholder, replacement);
  };

  /** The files the route would accept; the rest fail here with their copy. */
  const admit = (files: Iterable<File>): File[] => {
    const admitted: File[] = [];
    for (const file of files) {
      if (!isAttachmentMediaType(file.type)) {
        fail(t("shell.attach.unsupportedType"));
      } else if (file.size > ATTACHMENT_MAX_BYTES) {
        fail(t("shell.attach.tooLarge"));
      } else {
        admitted.push(file);
      }
    }
    return admitted;
  };

  const startUploads = (
    files: readonly File[],
    path: string,
    repoId: string,
  ) => {
    // One edit for the batch: every placeholder lands, in drop order, each
    // unique against the text already there.
    let placeholders: string[] = [];
    const inserted = applyEdit((text, start, end) => {
      placeholders = buildUploadPlaceholders(files, text, inFlightPlaceholders);
      return insertPlaceholder(text, start, end, placeholders.join("\n"));
    });
    if (!inserted) {
      return;
    }
    for (const placeholder of placeholders) {
      inFlightPlaceholders.add(placeholder);
    }
    (announceQuietly ?? announce)?.(t("shell.attach.uploading"));
    setInFlight((count) => count + files.length);
    const batch: UploadBatch = { limitReported: false };
    files.forEach((file, index) => {
      const placeholder = placeholders[index];
      if (placeholder !== undefined) {
        enqueueUpload(repoId, () =>
          settleUpload(path, file, placeholder, repoId, batch),
        );
      }
    });
  };

  const settleUpload = async (
    path: string,
    file: File,
    placeholder: string,
    repoId: string,
    batch: UploadBatch,
  ) => {
    // A batch behind a refused push: the first answer already said so, the
    // rest go quietly, without a request each.
    if (refusedRepoIds.has(repoId) || unwritableRepoIds.has(repoId)) {
      setInFlight((count) => count - 1);
      settle(placeholder, "");
      return;
    }
    const limitedBefore = isRepoLimited(repoId);
    if (limitedBefore) {
      setInFlight((count) => count - 1);
      settle(placeholder, "");
      if (!batch.limitReported) {
        batch.limitReported = true;
        fail(t("shell.attach.limitReached"));
      }
      return;
    }

    const result = await uploadImage(path, file);
    setInFlight((count) => count - 1);
    if (result.ok) {
      settle(placeholder, buildImageMarkdown(result.value));
      return;
    }
    recordRepoRefusal(repoId, result.error);
    const limitedNow = isRepoLimited(repoId);
    if (limitedNow) {
      batch.limitReported = true;
    }
    settle(placeholder, "");
    fail(failureCopy(t, result.error.cause));
  };

  return {
    disabledReason,
    inFlight,
    attach: (files) => {
      if (scope === undefined || disabledReason !== undefined || readOnly) {
        return;
      }
      const admitted = admit(files);
      if (admitted.length === 0) {
        return;
      }
      startUploads(
        admitted,
        buildUploadPath(scope.repoId, scope.prNumber),
        scope.repoId,
      );
    },
  };
}
