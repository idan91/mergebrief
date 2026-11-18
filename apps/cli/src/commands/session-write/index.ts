import type { Command } from "commander";
import { ProductActionIds } from "contract";
import type { Mutable } from "types";
import { CliError, ExitCodes } from "../../exit";
import type { CommandContext } from "../../types";
import { readPayload } from "../inputs";
import {
  addAnchorOptions,
  addPayloadExample,
  addPayloadOption,
  addSpanOptions,
  CATEGORY_CHOICES,
  FULL_PAYLOAD_DESCRIPTION,
  REQUIRED_PAYLOAD_DESCRIPTION,
  REVIEW_OUTCOME_CHOICES,
} from "../options";
import {
  ADDRESS_RISK_EXAMPLE,
  CREATE_DRAFT_EXAMPLE,
  DISMISS_RISK_EXAMPLE,
  REANCHOR_DRAFT_EXAMPLE,
  REOPEN_RISK_EXAMPLE,
  UPDATE_DRAFT_EXAMPLE,
} from "../payload-examples";
import { readGroupChunks } from "../brief-chunks";
import { parseSpanFlags, runPrivateWrite } from "../span";
import type { SpanFlags } from "../span/types";
import { parsePrNumber, resolveRepoTarget } from "../target";
import { readAttachmentFile, runAttach } from "./attach";
import { runChunkMarks, runSessionOperation } from "./run";
import type {
  AnchorFlags,
  CreateDraftInput,
  ReanchorInput,
  RiskFlags,
  RiskOperationId,
  UpdateDraftInput,
} from "./types";
import {
  buildCreateDraftPayload,
  buildReanchorPayload,
  buildRiskPayload,
  buildUpdateDraftPayload,
  resolveReadFlag,
} from "./utils";

export function registerDraftCommands(
  program: Command,
  context: CommandContext,
): void {
  const draft = program
    .command("draft")
    .description("draft review comments in your session (posted at submit)");

  registerDraftCreateCommand(draft, context);
  registerDraftUpdateCommand(draft, context);
  registerDraftReanchorCommand(draft, context);
  registerDraftDeleteCommand(draft, context);
  registerDraftAttachCommand(draft, context);
}

function registerDraftCreateCommand(
  draft: Command,
  context: CommandContext,
): void {
  const create = draft
    .command("create")
    .description("draft a new inline comment on the brief you are on")
    .argument("<number>", "PR number");
  addPayloadOption(create, FULL_PAYLOAD_DESCRIPTION);
  addPayloadExample(create, CREATE_DRAFT_EXAMPLE);
  addAnchorOptions(create).option("--body <text>", "comment body (flag form)");
  addSpanOptions(create).action(
    async (
      raw: string,
      options: AnchorFlags & {
        payload?: string;
        body?: string;
        revision?: string;

        base?: string;

        head?: string;
      },
    ) => {
      const prNumber = parsePrNumber(raw);
      const selection = parseSpanFlags(options);
      const input: Mutable<CreateDraftInput> = {
        file: options.file,
        side: options.side,
        startSide: options.startSide,
        start: options.start,
        end: options.end,
        body: options.body,
      };

      if (options.payload !== undefined) {
        input.payload = await readPayload(context.deps, options.payload);
      }

      const payload = buildCreateDraftPayload(input);
      const target = await resolveRepoTarget(context);
      const { client, repoId, io } = target;
      await runPrivateWrite(target, prNumber, selection, (span) =>
        runSessionOperation(
          client,
          {
            id: ProductActionIds.CREATE_DRAFT_COMMENT,
            params: { repoId, prNumber },
            span,
            payload,
          },
          io,
        ),
      );
    },
  );
}

function registerDraftUpdateCommand(
  draft: Command,
  context: CommandContext,
): void {
  const update = draft
    .command("update")
    .description("edit a held draft's body")
    .argument("<number>", "PR number")
    .argument("<draftId>", "the draft id (see `session <n>`)");
  addPayloadOption(update, FULL_PAYLOAD_DESCRIPTION).option(
    "--body <text>",
    "new comment body (flag form)",
  );
  addPayloadExample(update, UPDATE_DRAFT_EXAMPLE);
  addSpanOptions(update).action(
    async (
      raw: string,
      draftId: string,
      options: {
        payload?: string;
        body?: string;
        revision?: string;

        base?: string;

        head?: string;
      },
    ) => {
      const prNumber = parsePrNumber(raw);
      const selection = parseSpanFlags(options);
      const input: Mutable<UpdateDraftInput> = { body: options.body };

      if (options.payload !== undefined) {
        input.payload = await readPayload(context.deps, options.payload);
      }

      const payload = buildUpdateDraftPayload(input);
      const target = await resolveRepoTarget(context);
      const { client, repoId, io } = target;
      await runPrivateWrite(target, prNumber, selection, (span) =>
        runSessionOperation(
          client,
          {
            id: ProductActionIds.UPDATE_DRAFT_COMMENT,
            params: { repoId, prNumber, draftId },
            span,
            payload,
          },
          io,
        ),
      );
    },
  );
}

function registerDraftReanchorCommand(
  draft: Command,
  context: CommandContext,
): void {
  const reanchor = draft
    .command("reanchor")
    .description("move a held draft's anchor (settles a carried orphan)")
    .argument("<number>", "PR number")
    .argument("<draftId>", "the draft id (see `session <n>`)");
  addPayloadOption(reanchor, FULL_PAYLOAD_DESCRIPTION);
  addPayloadExample(reanchor, REANCHOR_DRAFT_EXAMPLE);
  addAnchorOptions(reanchor);
  addSpanOptions(reanchor).action(
    async (
      raw: string,
      draftId: string,
      options: AnchorFlags & {
        payload?: string;
        revision?: string;

        base?: string;

        head?: string;
      },
    ) => {
      const prNumber = parsePrNumber(raw);
      const selection = parseSpanFlags(options);
      const input: Mutable<ReanchorInput> = {
        file: options.file,
        side: options.side,
        startSide: options.startSide,
        start: options.start,
        end: options.end,
      };

      if (options.payload !== undefined) {
        input.payload = await readPayload(context.deps, options.payload);
      }

      const payload = buildReanchorPayload(input);
      const target = await resolveRepoTarget(context);
      const { client, repoId, io } = target;
      await runPrivateWrite(target, prNumber, selection, (span) =>
        runSessionOperation(
          client,
          {
            id: ProductActionIds.REANCHOR_DRAFT_COMMENT,
            params: { repoId, prNumber, draftId },
            span,
            payload,
          },
          io,
        ),
      );
    },
  );
}

function registerDraftDeleteCommand(
  draft: Command,
  context: CommandContext,
): void {
  const remove = draft
    .command("delete")
    .description("delete a held draft")
    .argument("<number>", "PR number")
    .argument("<draftId>", "the draft id (see `session <n>`)");
  addSpanOptions(remove).action(
    async (raw: string, draftId: string, options: SpanFlags) => {
      const prNumber = parsePrNumber(raw);
      const selection = parseSpanFlags(options);

      const target = await resolveRepoTarget(context);
      const { client, repoId, io } = target;
      await runPrivateWrite(target, prNumber, selection, (span) =>
        runSessionOperation(
          client,
          {
            id: ProductActionIds.DELETE_DRAFT_COMMENT,
            params: { repoId, prNumber, draftId },
            span,
          },
          io,
        ),
      );
    },
  );
}

function registerDraftAttachCommand(
  draft: Command,
  context: CommandContext,
): void {
  draft
    .command("attach")
    .description(
      "upload an image to the repository's attachments branch; prints {url}",
    )
    .argument("<number>", "PR number")
    .argument("<file>", "a png, jpg, gif or webp file")
    .option("--draft <draftId>", "also append the image to this held draft")
    .option("--revision <n>", "the brief revision holding it (with --draft)")
    .option("--base <sha>", "span base of the brief (with --draft)")
    .option("--head <sha>", "span head of the brief (with --draft)")
    .action(
      async (
        raw: string,
        path: string,
        options: SpanFlags & { draft?: string },
      ) => {
        const prNumber = parsePrNumber(raw);
        const file = readAttachmentFile(context.deps, path);
        const { draft: draftId } = options;
        const selection = parseSpanFlags(options);

        const target = await resolveRepoTarget(context);
        const { client, repoId, io } = target;
        if (draftId === undefined) {
          await runAttach(client, { repoId, prNumber, file }, io);
          return;
        }
        await runPrivateWrite(target, prNumber, selection, (span) =>
          runAttach(
            client,
            { repoId, prNumber, file, draft: { draftId, span } },
            io,
          ),
        );
      },
    );
}

export function registerChunkReadCommand(
  program: Command,
  context: CommandContext,
): void {
  const chunkRead = program
    .command("chunk-read")
    .description("mark brief chunks read (--unread clears the marks)")
    .argument("<number>", "PR number")
    .argument("[chunkId...]", "the chunk ids as the brief spells them")
    .option("--group <id>", "every chunk in this change group, in place of ids")
    .option("--read", "mark read (the default)")
    .option("--unread", "clear the read mark");
  addSpanOptions(chunkRead).action(
    async (
      raw: string,
      chunkIds: string[],
      options: {
        group?: string;
        read?: boolean;
        unread?: boolean;
        revision?: string;

        base?: string;

        head?: string;
      },
    ) => {
      const prNumber = parsePrNumber(raw);
      const selection = parseSpanFlags(options);
      const read = resolveReadFlag(options.read, options.unread);
      const id = read
        ? ProductActionIds.MARK_CHUNK_READ
        : ProductActionIds.MARK_CHUNK_UNREAD;
      const { group } = options;
      const namesChunks = chunkIds.length > 0;
      const namesGroup = group !== undefined;
      const namesOneTarget = namesChunks !== namesGroup;
      if (!namesOneTarget) {
        throw new CliError(
          ExitCodes.USAGE,
          "name the chunk ids or pass --group, not both",
        );
      }

      const target = await resolveRepoTarget(context);
      const { client, repoId, io } = target;
      await runPrivateWrite(target, prNumber, selection, async (span) => {
        const brief = { repoId, prNumber, span };
        const ids =
          group === undefined
            ? chunkIds
            : (await readGroupChunks(client, brief, group)).map(
                (chunk) => chunk.id,
              );
        await runChunkMarks(client, { ...brief, id, chunkIds: ids }, io);
      });
    },
  );
}

function createRiskAction(
  context: CommandContext,
  id: RiskOperationId,
  takesReason: boolean,
): (raw: string, options: RiskFlags) => Promise<void> {
  return async (raw, options) => {
    const prNumber = parsePrNumber(raw);
    const selection = parseSpanFlags(options);
    let flagsPayload: unknown;
    if (options.payload !== undefined) {
      flagsPayload = await readPayload(context.deps, options.payload);
    }
    const payload = buildRiskPayload(
      flagsPayload,
      takesReason ? options.reason : undefined,
    );

    const target = await resolveRepoTarget(context);
    const { client, repoId, io } = target;
    await runPrivateWrite(target, prNumber, selection, (span) =>
      runSessionOperation(
        client,
        { id, params: { repoId, prNumber }, span, payload },
        io,
      ),
    );
  };
}

export function registerRiskCommands(
  program: Command,
  context: CommandContext,
): void {
  const risk = program
    .command("risk")
    .description("disposition the brief's risk flags in your session");

  const dismiss = risk
    .command("dismiss")
    .description("dismiss risk flags (the payload's flags array names them)")
    .argument("<number>", "PR number");
  addPayloadOption(dismiss, REQUIRED_PAYLOAD_DESCRIPTION).option(
    "--reason <text>",
    "dismissal reason (unless the payload carries one)",
  );
  addPayloadExample(dismiss, DISMISS_RISK_EXAMPLE);
  addSpanOptions(dismiss).action(
    createRiskAction(context, ProductActionIds.DISMISS_RISK, true),
  );

  const address = risk
    .command("address")
    .description("mark risk flags addressed (each flag carries its evidence)")
    .argument("<number>", "PR number");
  addPayloadOption(address, REQUIRED_PAYLOAD_DESCRIPTION);
  addPayloadExample(address, ADDRESS_RISK_EXAMPLE);
  addSpanOptions(address).action(
    createRiskAction(context, ProductActionIds.ADDRESS_RISK, false),
  );

  const reopen = risk
    .command("reopen")
    .description("undo dispositions on risk flags")
    .argument("<number>", "PR number");
  addPayloadOption(reopen, REQUIRED_PAYLOAD_DESCRIPTION);
  addPayloadExample(reopen, REOPEN_RISK_EXAMPLE);
  addSpanOptions(reopen).action(
    createRiskAction(context, ProductActionIds.REOPEN_RISK, false),
  );
}

export function registerReclassifyCommand(
  program: Command,
  context: CommandContext,
): void {
  const reclassify = program
    .command("reclassify")
    .description("override a change group's category in your session")
    .argument("<number>", "PR number")
    .argument("<groupId>", "the change group id (see `groups <n>`)")
    .requiredOption(
      "--category <category>",
      `the category to record: ${CATEGORY_CHOICES}`,
    );
  addSpanOptions(reclassify).action(
    async (
      raw: string,
      groupId: string,
      options: SpanFlags & { category: string },
    ) => {
      const prNumber = parsePrNumber(raw);
      const selection = parseSpanFlags(options);

      const target = await resolveRepoTarget(context);
      const { client, repoId, io } = target;
      await runPrivateWrite(target, prNumber, selection, (span) =>
        runSessionOperation(
          client,
          {
            id: ProductActionIds.RECLASSIFY_GROUP,
            params: { repoId, prNumber, groupId },
            span,
            payload: { category: options.category },
          },
          io,
        ),
      );
    },
  );
}

export function registerOutcomeCommand(
  program: Command,
  context: CommandContext,
): void {
  const outcomeCommand = program
    .command("outcome")
    .description("set your session's review intent (publishing is `submit`)")
    .argument("<number>", "PR number")
    .argument("<outcome>", REVIEW_OUTCOME_CHOICES);
  addSpanOptions(outcomeCommand).action(
    async (raw: string, outcome: string, options: SpanFlags) => {
      const prNumber = parsePrNumber(raw);
      const selection = parseSpanFlags(options);

      const target = await resolveRepoTarget(context);
      const { client, repoId, io } = target;
      await runPrivateWrite(target, prNumber, selection, (span) =>
        runSessionOperation(
          client,
          {
            id: ProductActionIds.SET_REVIEW_OUTCOME,
            params: { repoId, prNumber },
            span,
            payload: { outcome },
          },
          io,
        ),
      );
    },
  );
}
