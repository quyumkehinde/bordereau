// npm run seed [-- --all] [-- --broken]
// Resets the database and loads the demo insurers from data/generated through the real import path.
// By default Insurers A and B are fully loaded and C is created empty, ready to onboard live.
//   --all      also load Insurer C (using its corrected month-2 resend)
//   --broken   with --all, load C's original month-2 file containing the movement break
import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { sql } from "drizzle-orm";
import { db, pg, schema } from "../src/db";
import type { Manifest } from "../src/lib/manifest";
import { approveMapping, receiveUpload } from "../src/server/imports";

const { values } = parseArgs({ options: { all: { type: "boolean" }, broken: { type: "boolean" }, force: { type: "boolean" } } });
if (process.env.NODE_ENV === "production" && !values.force) {
  console.error("Refusing to reset a production database without --force.");
  process.exit(2);
}

const manifest: Manifest = JSON.parse(readFileSync("data/generated/manifest.json", "utf8"));

await db.execute(sql`truncate issues, claims, policies, imports, mapping_configs, insurers restart identity cascade`);

for (const ins of manifest.insurers) {
  const [row] = await db.insert(schema.insurers).values({ name: ins.name }).returning();
  const load = ins.id !== "C" || values.all;
  if (!load) {
    console.log(`${ins.name}: created, no files (onboard it in the UI)`);
    continue;
  }
  for (const month of manifest.months) {
    for (const kind of ["policy", "claim"] as const) {
      const file = manifest.files.find((f) => f.insurer === ins.id && f.month === month && f.kind === kind)!;
      const filePath = file.correctedPath && !values.broken ? file.correctedPath : file.path;
      const res = await receiveUpload({ insurerId: row.id, kind, month, filename: path.basename(filePath), data: readFileSync(filePath) });
      if (res.status === "failed") throw new Error(`${filePath}: ${res.error}`);
      if (res.status === "needs_mapping") {
        // Stands in for a reviewer approving the mapping in the UI.
        const approved = await approveMapping(res.importId, file.mapping);
        if (!approved.ok) throw new Error(`${filePath}: ${approved.errors.join("; ")}`);
      }
      console.log(`${ins.name}: ${kind} ${month} <- ${filePath} (${res.status === "imported" ? "saved mapping" : "approved mapping"})`);
    }
  }
}
await pg.end();
