import { z } from "zod/v4";

/** A wire value that lands in an `href` or `src`: only https passes, so no `javascript:` or `data:` URL reaches the DOM. */
export const httpsUrlSchema = z.string().startsWith("https://");
