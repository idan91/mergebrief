import { readFileSync } from "node:fs";
import { z } from "zod/v4";
import { TicketTrackers, type Result } from "types";
import { createI18n } from "i18n";
import { ContextProviderTypes, type PrimarySnippet } from "brief-core";
import {
  ReferenceLocations,
  TicketUnreadReasons,
  type PrimaryTicket,
} from "brief-core/types";

/**
 * The `--context <file>` shape: the primary ticket's text, for any tracker
 * an MCP or a script can read. Only `url` and `content` are required.
 */
const contextFileSchema = z
  .object({
    url: z.string().min(1),
    key: z.string().default(""),
    tracker: z
      .enum([TicketTrackers.GITHUB, TicketTrackers.NOTION])
      .default(TicketTrackers.GITHUB),
    title: z.string().default(""),
    header: z.string().default(""),
    content: z.string().min(1),
  })
  .strict();

function readTextFile(path: string): Result<string, string> {
  try {
    return { ok: true, value: readFileSync(path, "utf8") };
  } catch {
    return { ok: false, error: `--context: cannot read ${path}` };
  }
}

function parseJsonText(raw: string, path: string): Result<unknown, string> {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: `--context: ${path} is not valid JSON` };
  }
}

function describeSchemaError(error: z.ZodError, path: string): string {
  const firstLine = z.prettifyError(error).split("\n")[0] ?? "invalid";
  return `--context: ${path} — ${firstLine}`;
}

function toPrimarySnippet(
  file: z.infer<typeof contextFileSchema>,
): PrimarySnippet {
  return {
    providerId: ContextProviderTypes.URL,
    source: file.url,
    text: file.content,
    tracker: file.tracker,
    key: file.key,
    title: file.title,
    header: file.header,
    foundIn: ReferenceLocations.DESCRIPTION,
  };
}

/** Read the file into the snippet the fan-out stamps as read: read, parse, validate, shape. */
export function readContextFile(path: string): Result<PrimarySnippet, string> {
  const raw = readTextFile(path);
  if (!raw.ok) {
    return raw;
  }

  const json = parseJsonText(raw.value, path);
  if (!json.ok) {
    return json;
  }

  const file = contextFileSchema.safeParse(json.value);
  if (!file.success) {
    return { ok: false, error: describeSchemaError(file.error, path) };
  }

  return { ok: true, value: toPrimarySnippet(file.data) };
}

const i18n = createI18n();

/**
 * The reason sentence, read mid-line. Only `unsupported` opens on a word the
 * catalog capitalizes standalone; every other reason opens on the tracker.
 */
function readUnreadReason(ticket: PrimaryTicket, tracker: string): string {
  if (ticket.reason === "") {
    return "";
  }
  if (ticket.reason === TicketUnreadReasons.UNSUPPORTED) {
    return i18n.t("brief.intent.reason.unsupported", {
      tracker,
      context: "inline",
    });
  }
  return i18n.t(`brief.intent.reason.${ticket.reason}`, { tracker });
}

/**
 * The stderr line for an unread primary: `error: <key> could not be read
 * (<code>); <sentence>`, the same sentence the web copy renders. The run
 * still exits 0: the brief was generated, the read is absent.
 */
export function describeUnreadPrimary(ticket: PrimaryTicket): string {
  const label = ticket.key === "" ? ticket.url : ticket.key;
  const tracker = i18n.t(`brief.intent.tracker.${ticket.tracker}`);
  const reason = readUnreadReason(ticket, tracker);
  return `error: ${label} could not be read (${ticket.reason}) — ${reason}`;
}
