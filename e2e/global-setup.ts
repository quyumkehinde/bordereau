import { execSync } from "node:child_process";

// Start every run from the demo state: A and B loaded, C created empty.
export default function globalSetup() {
  execSync("npx tsx scripts/seed.ts", { stdio: "inherit" });
}
