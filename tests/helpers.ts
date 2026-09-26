import { readFileSync } from "node:fs";
import type { Manifest } from "@/lib/manifest";
import { parseFile } from "@/lib/parse";

export const manifest: Manifest = JSON.parse(readFileSync("data/generated/manifest.json", "utf8"));

export function parsePath(p: string) {
  return parseFile(readFileSync(p), p);
}
