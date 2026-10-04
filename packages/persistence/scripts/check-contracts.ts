// `pnpm -C packages/persistence check:migrations`: judges every checked-in
// migration under `drizzle/` and exits non-zero naming the files that drop,
// rename, retype or tighten without a `-- contracts <release>` first line.
import { fileURLToPath } from "node:url";
import { collectOffenders } from "./migration-contracts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

function main(): number {
  const offenders = collectOffenders(MIGRATIONS_DIR);
  if (offenders.length === 0) {
    process.stdout.write("migrations: every contract names its release\n");
    return 0;
  }

  for (const offender of offenders) {
    process.stderr.write(
      `${offender.file}: drops, renames, retypes or tightens without a first line ` +
        "`-- contracts <release>` naming the release whose expand step it finishes\n",
    );
    for (const statement of offender.statements) {
      process.stderr.write(`  ${statement}\n`);
    }
  }
  return 1;
}

process.exit(main());
