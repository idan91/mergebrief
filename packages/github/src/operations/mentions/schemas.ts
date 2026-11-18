import { z } from "zod/v4";

const wireMentionableUserSchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string(),
});

// `repository` is null when the token cannot see it; connection nodes are a
// nullable list of nullable elements, per GitHub's schema-wide convention.
export const mentionableUsersResponseSchema = z.object({
  repository: z
    .object({
      mentionableUsers: z.object({
        nodes: z.array(wireMentionableUserSchema.nullable()).nullable(),
      }),
    })
    .nullable(),
});

const combinedSlugSchema = z.templateLiteral([
  z.string().min(1),
  "/",
  z.string().min(1),
]);

// `organization` is null when the login names a person or no account.
export const mentionableTeamsResponseSchema = z.object({
  organization: z
    .object({
      teams: z.object({
        nodes: z
          .array(
            z
              .object({ combinedSlug: combinedSlugSchema, name: z.string() })
              .nullable(),
          )
          .nullable(),
      }),
    })
    .nullable(),
});

// A null or missing alias is an answer: GitHub shows the viewer no such
// account or team.
export const userAliasSchema = z.object({ login: z.string() }).nullish();

export const teamAliasSchema = z
  .object({ team: z.object({ combinedSlug: combinedSlugSchema }).nullable() })
  .nullish();

export const aliasedResponseSchema = z.record(z.string(), z.unknown());
