import { defineConfig } from "drizzle-kit";

const databaseUrl = process.env["DATABASE_URL"];

if (databaseUrl === undefined) {
  throw new Error(
    "DATABASE_URL is required to run drizzle-kit against this package.",
  );
}

// Scoped to the app schema only. graphile-worker owns its own
// `graphile_worker` schema — drizzle must never introspect, generate, or
// migrate it. Restricting schemaFilter to `public` keeps that boundary
// enforced regardless of what else lives in the target database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema",
  out: "./drizzle",
  schemaFilter: ["public"],
  dbCredentials: {
    url: databaseUrl,
  },
});
