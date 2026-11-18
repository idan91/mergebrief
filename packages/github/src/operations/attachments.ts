// GitHub renders a private attachment in `bodyHTML` as a signed URL that
// lives a few minutes and needs no credential, where the bare asset URL
// refuses an App user token. So the rendered bodies are the only way to a
// private screenshot's or recording's bytes, and the only place that says
// a pasted asset is a video. Failures use mapGraphqlError.
import type { Octokit } from "octokit";
import { z } from "zod/v4";
import {
  mapGraphqlError,
  unexpectedResponseError,
  type GitHubApiError,
} from "../errors";
import type { Result } from "types/utils";
import { HttpStatuses } from "types/http";

export interface FetchRenderedMediaSourcesInput {
  readonly owner: string;
  readonly repo: string;
  readonly prNumber: number;
}

/** Every image and video source GitHub rendered for a pull request, each in document order. */
export interface RenderedMediaSources {
  readonly imageSources: readonly string[];
  readonly videoSources: readonly string[];
}

const FETCH_CONTEXT = "fetch rendered media sources";
const PAGE_SIZE = 100;
const IMAGE_SOURCE_PATTERN = /<img\b[^>]*?\ssrc="([^"]+)"/g;
const VIDEO_ELEMENT_PATTERN = /<video\b([^>]*)>([\s\S]*?)<\/video>/g;
const SOURCE_ELEMENT_PATTERN = /<source\b[^>]*?\ssrc="([^"]+)"/g;
const SOURCE_ATTRIBUTE_PATTERN = /\ssrc="([^"]+)"/;

const RENDERED_BODIES_QUERY = `
  query RenderedBodies($owner: String!, $repo: String!, $prNumber: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $prNumber) {
        bodyHTML
        comments(last: ${PAGE_SIZE}) { nodes { bodyHTML } }
        reviews(last: ${PAGE_SIZE}) { nodes { bodyHTML } }
        reviewThreads(last: ${PAGE_SIZE}) {
          nodes { comments(last: ${PAGE_SIZE}) { nodes { bodyHTML } } }
        }
      }
    }
  }
`;

const renderedNodeSchema = z.object({ bodyHTML: z.string() }).nullable();
const renderedConnectionSchema = z.object({
  nodes: z.array(renderedNodeSchema).nullable(),
});
const renderedBodiesResponseSchema = z.object({
  repository: z
    .object({
      pullRequest: z
        .object({
          bodyHTML: z.string(),
          comments: renderedConnectionSchema,
          reviews: renderedConnectionSchema,
          reviewThreads: z.object({
            nodes: z
              .array(
                z.object({ comments: renderedConnectionSchema }).nullable(),
              )
              .nullable(),
          }),
        })
        .nullable(),
    })
    .nullable(),
});

function collectBodies(
  pullRequest: NonNullable<
    NonNullable<
      z.infer<typeof renderedBodiesResponseSchema>["repository"]
    >["pullRequest"]
  >,
): string[] {
  const bodies = [pullRequest.bodyHTML];
  for (const node of pullRequest.comments.nodes ?? []) {
    if (node !== null) {
      bodies.push(node.bodyHTML);
    }
  }
  for (const node of pullRequest.reviews.nodes ?? []) {
    if (node !== null) {
      bodies.push(node.bodyHTML);
    }
  }
  for (const thread of pullRequest.reviewThreads.nodes ?? []) {
    for (const node of thread?.comments.nodes ?? []) {
      if (node !== null) {
        bodies.push(node.bodyHTML);
      }
    }
  }
  return bodies;
}

function collectMatches(html: string, pattern: RegExp): string[] {
  const sources: string[] = [];
  for (const match of html.matchAll(pattern)) {
    const source = match[1];
    if (source !== undefined && source !== "") {
      sources.push(source);
    }
  }
  return sources;
}

export function extractImageSources(html: string): string[] {
  return collectMatches(html, IMAGE_SOURCE_PATTERN);
}

/** A `<video>`'s own `src`, then each `<source src>` inside it. */
export function extractVideoSources(html: string): string[] {
  const sources: string[] = [];
  for (const [, attributes = "", content = ""] of html.matchAll(
    VIDEO_ELEMENT_PATTERN,
  )) {
    const [, own] = SOURCE_ATTRIBUTE_PATTERN.exec(attributes) ?? [];
    if (own !== undefined) {
      sources.push(own);
    }
    sources.push(...collectMatches(content, SOURCE_ELEMENT_PATTERN));
  }
  return sources;
}

/**
 * Every `<img src>` and `<video>` source GitHub rendered into the PR's
 * description, comments, reviews and review-thread comments, in document
 * order. A private attachment arrives as a signed `private-user-images` URL;
 * a public one as its bare asset URL. The caller picks the one it wants.
 */
export async function fetchRenderedMediaSources(
  octokit: Octokit,
  input: FetchRenderedMediaSourcesInput,
): Promise<Result<RenderedMediaSources, GitHubApiError>> {
  let response: unknown;
  try {
    response = await octokit.graphql(RENDERED_BODIES_QUERY, {
      owner: input.owner,
      repo: input.repo,
      prNumber: input.prNumber,
    });
  } catch (error) {
    return { ok: false, error: mapGraphqlError(error, FETCH_CONTEXT) };
  }

  const parsed = renderedBodiesResponseSchema.safeParse(response);
  if (!parsed.success) {
    return { ok: false, error: unexpectedResponseError(FETCH_CONTEXT) };
  }
  const pullRequest = parsed.data.repository?.pullRequest;
  if (pullRequest === null || pullRequest === undefined) {
    return { ok: false, error: resourceNotFoundError() };
  }

  const bodies = collectBodies(pullRequest);
  const imageSources = bodies.flatMap(extractImageSources);
  const videoSources = bodies.flatMap(extractVideoSources);
  return { ok: true, value: { imageSources, videoSources } };
}

function resourceNotFoundError(): GitHubApiError {
  return {
    code: "not-found",
    status: HttpStatuses.NOT_FOUND,
    message: `${FETCH_CONTEXT}: pull request not found`,
  };
}
