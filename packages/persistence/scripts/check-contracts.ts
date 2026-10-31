// `pnpm -C packages/persistence check:migrations`: judges every checked-in
// migration under `drizzle/` and exits non-zero naming the files that drop,
// rename, retype or tighten without a `-- contracts <release>` first line,
// and the journal entries whose `when` does not rise above the one before.
import { fileURLToPath } from "node:url";
import { collectJournalOrderOffenders } from "./journal-order";
import { collectOffenders } from "./migration-contracts";

const MIGRATIONS_DIR = fileURLToPath(new URL("../drizzle", import.meta.url));

function reportContractOffenders(): number {
  const offenders = collectOffenders(MIGRATIONS_DIR);
  for (const offender of offenders) {
    process.stderr.write(
      `${offender.file}: drops, renames, retypes or tightens without a first line ` +
        "`-- contracts <release>` naming the release whose expand step it finishes\n",
    );
    for (const statement of offender.statements) {
      process.stderr.write(`  ${statement}\n`);
    }
  }
  return offenders.length;
}

function reportJournalOrderOffenders(): number {
  const journal = collectJournalOrderOffenders(MIGRATIONS_DIR);
  if (!journal.ok) {
    process.stderr.write(`meta/_journal.json: ${journal.error}\n`);
    return 1;
  }

  for (const offender of journal.value) {
    process.stderr.write(
      `meta/_journal.json: ${offender.tag} has when ${String(offender.when)}, ` +
        `not above ${offender.previousTag}'s ${String(offender.previousWhen)}; ` +
        "drizzle skips it on a database already past the earlier entry\n",
    );
  }
  return journal.value.length;
}

function main(): number {
  const contractCount = reportContractOffenders();
  const journalCount = reportJournalOrderOffenders();
  if (contractCount + journalCount > 0) {
    return 1;
  }

  process.stdout.write(
    "migrations: every contract names its release and the journal rises\n",
  );
  return 0;
}

process.exit(main());
