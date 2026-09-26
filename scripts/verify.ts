// npm run verify [-- --insurer <name> --month yyyy-mm]
// Runs every verify check for each insurer and month on file. Exits nonzero on any mismatch.
import "dotenv/config";
import { parseArgs } from "node:util";
import { asc } from "drizzle-orm";
import { db, pg, schema } from "../src/db";
import { formatResults } from "../src/lib/verify";
import { claimMonths } from "../src/server/data";
import { verifyMonth } from "../src/server/reporting";

const { values } = parseArgs({ options: { insurer: { type: "string" }, month: { type: "string" } } });

const insurers = (await db.select().from(schema.insurers).orderBy(asc(schema.insurers.id))).filter(
  (i) => !values.insurer || i.name.toLowerCase().includes(values.insurer.toLowerCase()),
);
if (insurers.length === 0) {
  console.error("No matching insurers. Run npm run seed first?");
  process.exit(2);
}

let failed = 0;
let checked = 0;
for (const insurer of insurers) {
  const months = (await claimMonths(insurer.id)).filter((m) => !values.month || m === values.month);
  for (const month of months) {
    const results = await verifyMonth(insurer.id, month);
    checked++;
    if (results.some((r) => r.status === "fail")) failed++;
    console.log(formatResults(`${insurer.name} ${month}`, results) + "\n");
  }
}
await pg.end();

if (checked === 0) {
  console.error("Nothing to verify: no claims loaded.");
  process.exit(2);
}
console.log(failed === 0 ? `verify: ${checked} bordereaux reconcile.` : `verify: ${failed} of ${checked} bordereaux have mismatches.`);
process.exit(failed === 0 ? 0 : 1);
