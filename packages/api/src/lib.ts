// Package entry point — the whole public surface (BRIEF-2 stage 4). The app
// factory is the only export: consumers (the `apps/web` catch-all mount,
// stage 5) build deps and hand them in; routes are internal wiring.
export { createApp } from "./app";
export type { AppDeps } from "./app";
