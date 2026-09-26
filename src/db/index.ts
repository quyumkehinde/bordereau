import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "postgres://bordereau:bordereau@localhost:5433/bordereau";

// Reuse one pool across Next.js dev hot reloads.
const globalForDb = globalThis as unknown as { pg?: ReturnType<typeof postgres> };
export const pg = globalForDb.pg ?? postgres(url, { max: 10, onnotice: () => {} });
if (process.env.NODE_ENV !== "production") globalForDb.pg = pg;

export const db = drizzle(pg, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
