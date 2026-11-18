import { MentionTargetKinds, type MentionTarget } from "./types";

/** The alias a target answers under: `u<n>` for a user, `t<n>` for a team. */
export function getTargetAlias(
  target: MentionTarget,
  index: number,
): `u${number}` | `t${number}` {
  if (target.kind === MentionTargetKinds.USER) {
    const userAlias: `u${number}` = `u${index}`;
    return userAlias;
  }
  const teamAlias: `t${number}` = `t${index}`;
  return teamAlias;
}

export function buildTargetsQuery(targets: readonly MentionTarget[]): string {
  const declarations: string[] = [];
  const selections: string[] = [];
  targets.forEach((target, index) => {
    const alias = getTargetAlias(target, index);
    if (target.kind === MentionTargetKinds.USER) {
      declarations.push(`$u${index}: String!`);
      selections.push(`${alias}: repositoryOwner(login: $u${index}) { login }`);
      return;
    }
    declarations.push(`$o${index}: String!, $s${index}: String!`);
    selections.push(
      `${alias}: organization(login: $o${index}) { team(slug: $s${index}) { combinedSlug } }`,
    );
  });

  const variableDefinitions = declarations.join(", ");
  const selectionSet = selections.join(" ");
  const targetsQuery = `query MentionTargets(${variableDefinitions}) { ${selectionSet} }`;
  return targetsQuery;
}

export function buildTargetsVariables(
  targets: readonly MentionTarget[],
): Record<string, string> {
  const variables: Record<string, string> = {};
  targets.forEach((target, index) => {
    if (target.kind === MentionTargetKinds.USER) {
      variables[`u${index}`] = target.login;
      return;
    }
    variables[`o${index}`] = target.org;
    variables[`s${index}`] = target.slug;
  });
  return variables;
}
