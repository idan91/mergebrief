import type { Command } from "commander";
import { ProductActionIds } from "contract";
import type { Mutable } from "types";
import type { CommandContext } from "../../types";
import { readPayload } from "../inputs";
import {
  addAnchorOptions,
  addPayloadOption,
  addSpanOptions,
  FULL_PAYLOAD_DESCRIPTION,
  requireSpan,
} from "../options";
import { parsePrNumber, resolveRepoTarget } from "../target";
import {
  readAttachmentFile,
  runAttach,
  type AttachDraftTarget,
} from "./attach";
import { runSessionOperation } from "./run";
import type {
  AnchorFlags,
  CreateDraftInput,
  ReanchorInput,
  UpdateDraftInput,
} from "./types";
import {
  buildCreateDraftPayload,
  buildReanchorPayload,
  buildUpdateDraftPayload,
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
    .description("draft a new inline comment on the brief span you name")
    .argument("<number>", "PR number");
  addPayloadOption(create, FULL_PAYLOAD_DESCRIPTION);
  addAnchorOptions(create).option("--body <text>", "comment body (flag form)");
  addSpanOptions(create).action(
    async (
      raw: string,
      options: AnchorFlags & {
        payload?: string;
        body?: string;
        base?: string;
        head?: string;
      },
    ) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);
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
      const { client, repoId, io } = await resolveRepoTarget(context);
      await runSessionOperation(
        client,
        {
          id: ProductActionIds.CREATE_DRAFT_COMMENT,
          params: { repoId, prNumber },
          span,
          payload,
        },
        io,
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
  addSpanOptions(update).action(
    async (
      raw: string,
      draftId: string,
      options: {
        payload?: string;
        body?: string;
        base?: string;
        head?: string;
      },
    ) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);
      const input: Mutable<UpdateDraftInput> = { body: options.body };

      if (options.payload !== undefined) {
        input.payload = await readPayload(context.deps, options.payload);
      }

      const payload = buildUpdateDraftPayload(input);
      const { client, repoId, io } = await resolveRepoTarget(context);
      await runSessionOperation(
        client,
        {
          id: ProductActionIds.UPDATE_DRAFT_COMMENT,
          params: { repoId, prNumber, draftId },
          span,
          payload,
        },
        io,
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
  addAnchorOptions(reanchor);
  addSpanOptions(reanchor).action(
    async (
      raw: string,
      draftId: string,
      options: AnchorFlags & {
        payload?: string;
        base?: string;
        head?: string;
      },
    ) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);
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
      const { client, repoId, io } = await resolveRepoTarget(context);
      await runSessionOperation(
        client,
        {
          id: ProductActionIds.REANCHOR_DRAFT_COMMENT,
          params: { repoId, prNumber, draftId },
          span,
          payload,
        },
        io,
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
    async (
      raw: string,
      draftId: string,
      options: { base?: string; head?: string },
    ) => {
      const prNumber = parsePrNumber(raw);
      const span = requireSpan(options.base, options.head);

      const { client, repoId, io } = await resolveRepoTarget(context);
      await runSessionOperation(
        client,
        {
          id: ProductActionIds.DELETE_DRAFT_COMMENT,
          params: { repoId, prNumber, draftId },
          span,
        },
        io,
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
    .option(
      "--draft <draftId>",
      "also append the image to this held draft (needs --base and --head)",
    )
    .option("--base <sha>", "span base of the brief (with --draft)")
    .option("--head <sha>", "span head of the brief (with --draft)")
    .action(
      async (
        raw: string,
        path: string,
        options: { draft?: string; base?: string; head?: string },
      ) => {
        const prNumber = parsePrNumber(raw);
        const file = readAttachmentFile(context.deps, path);
        let target: AttachDraftTarget | undefined;
        if (options.draft !== undefined) {
          target = {
            draftId: options.draft,
            span: requireSpan(options.base, options.head),
          };
        }

        const { client, repoId, io } = await resolveRepoTarget(context);
        await runAttach(client, { repoId, prNumber, file, draft: target }, io);
      },
    );
}
