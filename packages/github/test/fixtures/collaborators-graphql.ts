// Wire-shaped fixtures for the collaborators connection (BRIEF-94). Nodes are
// GraphQL `User` objects — `name` is nullable, `login`/`avatarUrl` are not.

export interface GqlCollaboratorOptions {
  readonly login?: string;
  readonly name?: string | null;
  readonly avatarUrl?: string;
}

export function gqlCollaborator(options: GqlCollaboratorOptions = {}) {
  const login = options.login ?? "alice";
  return {
    login,
    name: options.name === undefined ? "Alice Example" : options.name,
    avatarUrl: options.avatarUrl ?? `https://avatars.example/${login}.png`,
  };
}

export interface CollaboratorsResponseOptions {
  readonly nodes?: ReadonlyArray<ReturnType<typeof gqlCollaborator> | null> | null;
  readonly hasNextPage?: boolean;
  readonly endCursor?: string | null;
}

export function collaboratorsResponse(options: CollaboratorsResponseOptions = {}) {
  return {
    repository: {
      collaborators: {
        pageInfo: {
          hasNextPage: options.hasNextPage ?? false,
          endCursor: options.endCursor ?? null,
        },
        nodes: options.nodes === undefined ? [gqlCollaborator()] : options.nodes,
      },
    },
  };
}
