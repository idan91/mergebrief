// Package entry point. Stage 2 exposes the schema tables and shared types;
// the tenant repository (`forTenant` — the only DB *handle* surface, D2b),
// ArtifactStore, audit emit, and generation helpers land in later stages
// (see docs/plans/brief-1-persistence-layer.md). Note: exporting table
// definitions is fine — the D2b rule forbids exporting a raw DB handle,
// not the schema metadata.

export * from "./schema/index.js";
export * from "./types.js";

/**
 * Placeholder export so the package has a non-empty public surface while
 * `forTenant` and friends are still being built out stage by stage.
 */
export const PERSISTENCE_PACKAGE_NAME = "persistence";
