// The Claude path's output handling, without calling the API.
import { expect, it } from "vitest";
import { wireToMapping, type WireSuggestion } from "@/lib/suggest";

const col = (source: string, target: string, extra: Partial<WireSuggestion["columns"][number]> = {}) => ({
  source,
  target,
  transform: "none" as const,
  date_order: "n/a" as const,
  enum_values: [],
  confidence: 0.9,
  note: "",
  ...extra,
});

it("converts the flat wire shape, clamps confidence, and flags anything the model skipped", () => {
  const m = wireToMapping(["Clm No", "DOL", "Clsd", "Lit", "Extra"], {
    default_currency: "GBP",
    columns: [
      col("clm no", "claim_ref", { confidence: 1.4 }),
      col("DOL", "date_of_loss", { transform: "date", date_order: "DMY" }),
      col("Clsd", "status", { transform: "enum", enum_values: [{ raw: "Y", value: "closed" }, { raw: "N", value: "open" }] }),
      col("Lit", "ignore", { confidence: -1 }),
    ],
  });
  expect(m.defaultCurrency).toBe("GBP");
  expect(m.columns).toEqual([
    { source: "Clm No", target: "claim_ref", transform: { kind: "none" }, confidence: 1 },
    { source: "DOL", target: "date_of_loss", transform: { kind: "date", order: "DMY" }, confidence: 0.9 },
    { source: "Clsd", target: "status", transform: { kind: "enum", values: { Y: "closed", N: "open" } }, confidence: 0.9 },
    { source: "Lit", target: null, transform: { kind: "none" }, confidence: 0 },
    { source: "Extra", target: null, transform: { kind: "none" }, confidence: 0, note: "No suggestion returned for this column" },
  ]);
});

it("keeps the more confident of two columns claiming one field", () => {
  const m = wireToMapping(["Paid", "Pd"], {
    default_currency: "",
    columns: [col("Paid", "paid_to_date", { confidence: 0.5, transform: "amount" }), col("Pd", "paid_to_date", { confidence: 0.8, transform: "amount" })],
  });
  expect(m.defaultCurrency).toBeNull();
  expect(m.columns.map((c) => c.target)).toEqual([null, "paid_to_date"]);
  expect(m.columns[0].note).toMatch(/Also looked like paid_to_date/);
});
