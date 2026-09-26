// Loads the Kaggle travel insurance dataset (63,326 policies from a Singapore travel insurance servicer).
// https://www.kaggle.com/datasets/mhdzahier/travel-insurance
import { existsSync, readFileSync } from "node:fs";
import Papa from "papaparse";

export interface BasePolicy {
  agency: string;
  channel: string;
  product: string;
  durationDays: number;
  destination: string;
  netSales: number;
  claimed: boolean;
}

export function loadBase(path: string): { rows: BasePolicy[]; total: number } {
  if (!existsSync(path)) {
    throw new Error(
      `Base dataset not found at ${path}.\n` +
        "Download https://www.kaggle.com/datasets/mhdzahier/travel-insurance and save the CSV there.",
    );
  }
  const parsed = Papa.parse<Record<string, string>>(readFileSync(path, "utf8"), { header: true, skipEmptyLines: true });
  const rows = parsed.data
    .map((r) => ({
      agency: r["Agency"],
      channel: r["Distribution Channel"],
      product: r["Product Name"],
      durationDays: Number(r["Duration"]),
      destination: r["Destination"],
      netSales: Number(r["Net Sales"]),
      claimed: r["Claim"] === "Yes",
    }))
    // Drop refunds (net sales <= 0) and nonsense durations (<= 0 or multi-year).
    .filter((r) => r.durationDays >= 1 && r.durationDays <= 365 && r.netSales > 0);
  return { rows, total: parsed.data.length };
}
