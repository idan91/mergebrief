# MergeBrief documentation

MergeBrief writes a brief for every pull request: what changed, grouped by intent, with the risks a reviewer should look at first. You run your own instance next to your own GitHub App and model key; reviewers sign in with GitHub, read the brief, and submit their review to GitHub from it.

Start from what you came to do:

- **[Review a pull request](./use/reviewing.md).** Read a brief, decide its risk flags, and submit your review to GitHub.
- **[Run an instance](./self-host/README.md).** Install MergeBrief on your own machine or a server, then configure, secure and operate it.
- **[Configure a repository](./repo-config/README.md).** Change how one repository's briefs are made with a `.mergebrief/` directory on its default branch.
- **[Use the CLI or an agent](./use/cli.md).** Read and review briefs from a terminal, a script, CI or a coding agent with the `mergebrief` CLI.
