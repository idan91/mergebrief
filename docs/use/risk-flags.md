# Risk flags

A risk flag is one risk attribute firing on one chunk of a brief. It states a fact about the change, such as "this chunk touches auth code". It never says the change is wrong. You decide that, and you record the decision by addressing the flag with evidence or dismissing it with a reason ([Act on risk flags](./reviewing.md#act-on-risk-flags)).

This page lists every built-in attribute: what it means, how to check it fast, and whether it is a floor attribute.

## Read a flag

A flag shows as a badge on its chunk and in the **Risk surface** list of its change group. Click or focus a badge to read the attribute's one-line description. A file row with notes has a **Risk notes** toggle that shows the model's note for each flag on that file.

The **Risk attributes** button on the reading toolbar lists every attribute that fired in the brief, except the ones the repository quieted. Click an attribute to jump to the first group that carries it, then click again to step to the next one.

Read flags together. One attribute is a description; a combination is the signal:

- **Touches auth** with **No tests** and **Widely imported** is a security change with no safety net and wide reach. Read it line by line.
- **Mutates state** with **External I/O** and **Release imminent** can leave partial state on a short schedule. Check idempotency and rollback.
- **Removes validation** with **Cross-service** loosens a contract someone else relies on. Ask for the migration plan.

## Floor attributes

Five attributes are the floor: **Touches auth**, **Removes validation**, **Relaxes permissions**, **Adds a secret** and **Changes package source**. A repository's policy can quiet other attributes, but never these. When a quieted attribute fires on the same chunk as a floor attribute, it shows at full weight too. When a floor attribute fires, the **Risk attributes** button carries a dot.

## Flags a repository adds or quiets

A repository can add its own attributes and quiet built-in ones in `.mergebrief/policy.yaml` ([Risk policy](../repo-config/policy.md)).

- A badge marked **Defined by repo policy** is the repository's own attribute. Its description is the repository's text.
- A badge marked **De-emphasized by repo policy** is a built-in the repository quieted. It shows lighter but still counts as open until you address or dismiss it.

## About the code

These describe the code the chunk sits in, whatever the diff does.

### No tests

`no-tests`. The changed code path has no test coverage in the repository.

Check: look for a test chunk in the same group, then search the repository for a test of the changed function. If none exists, run the behaviour yourself or ask for a test. The flag never fires on style sheets, Markdown, images, configuration files, container files, Make files or shell scripts.

Floor: no.

### No types

`no-types`. The changed code has no useful types: `any`, untyped parameters, or dynamic code with no runtime validation.

Check: find where outside data enters the changed code and confirm it is parsed or narrowed there.

Floor: no.

### Legacy area

`legacy-area`. The file carries a legacy marker: `@deprecated`, a `TODO` or `FIXME`, or a `legacy/` path.

Check: confirm the change follows the codebase's current pattern rather than extending the old one.

Floor: no.

### Dense logic

`dense-logic`. The chunk branches heavily: three or more levels of nesting, or five or more branches.

Check: list the inputs that reach each branch and trace each one. Look for the branch with no test.

Floor: no.

## About the change

These describe what this diff does.

### Touches auth

`touches-auth`. The diff changes authentication, authorization, session or identity code.

Check: confirm the new code cannot widen access, leak a token or skip a check for any input.

Floor: yes.

### Mutates state

`mutates-state`. The diff writes persistent state: database writes, file writes, module-level variables, cache writes or invalidations.

Check: confirm the write order, what happens when it runs twice, and what is left behind when it fails halfway.

Floor: no.

### Removes validation

`removes-validation`. The diff weakens a check: a guard, a type narrowing, a schema constraint, an assertion or a range check. It fires only on chunks that delete lines.

Check: find the input the old check rejected and confirm it is now safe to accept, or rejected somewhere else.

Floor: yes.

### Relaxes permissions

`relaxes-permissions`. The diff broadens an access check, a role list, a scope or an access list.

Check: name every actor who is newly admitted and confirm the author meant each one.

Floor: yes.

### Widens error handling

`widens-error-handling`. The diff catches more errors, swallows them, or turns an error into a warning or a no-op.

Check: confirm each broader catch is on purpose and cannot hide a real bug.

Floor: no.

### Adds feature flag

`adds-feature-flag`. The diff adds or changes a feature-flag check.

Check: confirm the flag's default, how it rolls out, and when it gets removed.

Floor: no.

### New dependency

`new-dependency`. The diff adds a package that was not a direct dependency before. A version bump does not fire it.

Check: confirm the standard library or an existing dependency cannot do the job, and that the license and maintenance are acceptable. It matters most when the group is not a dependency change: a package that arrives inside a feature or a fix is easy to miss.

Floor: no.

### New abstraction

`new-abstraction`. The diff adds a new named abstraction: a class, interface, service, wrapper or layer. Moved code does not fire it.

Check: ask whether an existing pattern or utility already covers it, and whether one call site justifies a new layer.

Floor: no.

### Comment contradicts code

`comment-contradicts-code`. A comment or docstring in the diff seems to disagree with the code next to it.

Check: read both and decide which side is right. Either the code or the comment needs fixing. The flag does not say which.

Floor: no.

### Adds a secret

`adds-secret`. An added line holds a credential in a known format, such as a private key, a provider token, a JWT or a password in a URL, or a value under a key named like a secret. MergeBrief sets it from the diff itself and redacts the value before the model sees it.

Check: unless the value is plainly not a credential, treat it as leaked. Rotate it, then ask for it to come out of the repository and its history. Merging spreads it further. A credential on a removed line does not fire it.

Floor: yes.

### Changes package source

`changes-package-source`. A pnpm, npm or yarn lockfile moves where a package's code comes from, or a registry config file changed (`.npmrc`, `.yarnrc`, `.yarnrc.yml`, `pnpm-workspace.yaml`). MergeBrief sets it from the diff itself. It also fires on a lockfile it cannot read.

Check: confirm each changed package matches a manifest change you expect, and that resolved URLs still point at your registry. For a registry config file, read the config change itself: it can redirect every package. A lockfile can swap a package's source at the same version, which the manifest diff never shows.

Floor: yes.

## About the blast radius

These describe what depends on the changed code.

### External I/O

`external-io`. The chunk reaches outside the process: network calls, the file system, child processes or a third-party SDK.

Check: confirm the timeout, the retry, what a repeated call does, and what happens when the other side is down.

Floor: no.

### Cross-service

`cross-service`. The chunk changes a contract that another service or deployable consumes: an API body, a queue payload, a shared table or a published library surface. A brand-new endpoint with no consumers does not fire it.

Check: confirm older consumers still work, or that a migration plan exists for them.

Floor: no.

### Schema-adjacent

`schema-adjacent`. The chunk sits next to a schema, a migration or the persistence layer without changing the schema itself.

Check: confirm the change agrees with what the schema assumes, such as nullability, uniqueness and defaults.

Floor: no.

### Hot path

`hot-path`. The chunk runs on a path with high traffic or a latency budget, such as per-request middleware or a serving loop.

Check: look for new allocations, synchronous I/O and loops with no bound.

Floor: no.

### Widely imported

`widely-imported`. The changed function or symbol already has many call sites, roughly ten or more. A new export never fires it.

Check: list the callers and confirm each one tolerates the new behaviour.

Floor: no.

### Release imminent

`release-imminent`. The pull request targets a release branch, is marked as a backport or hotfix, or names a ship date within about a day.

Check: prefer the smallest fix that works, and confirm how to revert it.

Floor: no.
