import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: BriefApp,
});

export function BriefApp() {
  return (
    <main className="app-shell">
      <p>Brief app scaffold</p>
    </main>
  );
}
