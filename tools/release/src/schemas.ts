import { z } from "zod/v4";

/** The three lines a notes file's front matter may carry, nothing else. */
export const FrontMatterSchema = z.strictObject({
  date: z.iso.date(),
  breaking: z.boolean(),
  security: z.boolean(),
});

export type FrontMatter = z.infer<typeof FrontMatterSchema>;

/** What the stamp needs of a package manifest; every other key passes through. */
export const PackageManifestSchema = z.looseObject({
  version: z.string(),
});
