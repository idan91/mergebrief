import { z } from "zod/v4";

import { positiveBigIntSchema } from "../../ids";
import { GitHubAccountTypes } from "../../types";
import { CommitStatusStates } from "./types";

export const checkRunListSchema = z.array(
  z.object({
    id: positiveBigIntSchema,
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullish(),
    app: z.object({ id: positiveBigIntSchema }).nullish(),
    output: z
      .object({ title: z.string().nullish(), text: z.string().nullish() })
      .nullish(),
  }),
);

export const commitStatusListSchema = z.array(
  z.object({
    context: z.string(),
    state: z.enum(CommitStatusStates),
    creator: z
      .object({
        id: positiveBigIntSchema,
        type: z.enum(GitHubAccountTypes).optional().catch(undefined),
      })
      .nullish(),
  }),
);

export const branchRuleListSchema = z.array(
  z.object({ type: z.string(), parameters: z.unknown().optional() }),
);

export const requiredStatusChecksParametersSchema = z.object({
  required_status_checks: z.array(
    z.object({
      context: z.string(),
      integration_id: positiveBigIntSchema.nullish(),
    }),
  ),
});
