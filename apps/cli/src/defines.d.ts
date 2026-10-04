/**
 * The CLI's version, injected at build time by tsup from `package.json`
 * (`0.0.0` in the repo, the tag at publish) and by vitest for the tests. A
 * tsx run (`scripts/embed-help.ts`, `scripts/check-operations-map.ts`) has
 * no define and reads as `0.0.0`.
 */
// oxlint-disable-next-line no-underscore-dangle -- the bundler define convention
declare const __CLI_VERSION__: string | undefined;
