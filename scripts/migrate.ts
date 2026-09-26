import "dotenv/config";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, pg } from "../src/db";

await migrate(db, { migrationsFolder: "drizzle" });
console.log("Migrations applied.");
await pg.end();
