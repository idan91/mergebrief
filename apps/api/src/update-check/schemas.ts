import { z } from "zod/v4";

/** A link the web app will render: http(s) only, anything else is dropped. */
const NotesUrlSchema = z
  .url({ protocol: /^https?$/ })
  .optional()
  .catch(undefined);

/** Tolerant read: unknown fields pass, a malformed entry drops on its own. */
export const ReleaseEntrySchema = z.object({
  version: z.string().min(1),
  date: z.string().optional(),
  breaking: z.boolean().default(false),
  security: z.boolean().default(false),
  notesUrl: NotesUrlSchema,
});

export const VersionManifestSchema = z.object({
  latest: z.string().min(1),
  releaseNotesUrl: NotesUrlSchema,
  releases: z.array(z.unknown()).default([]),
});
