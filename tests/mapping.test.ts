import { describe, expect, it } from "vitest";
import { carryOver, checkMapping, diffLayout, headersHash, isLayoutRevision, parseAmount, parseDate, type Mapping } from "@/lib/mapping";

const saved: Mapping = {
  columns: [
    { source: "Clm No", target: "claim_ref", transform: { kind: "none" } },
    { source: "Pol No", target: "policy_ref", transform: { kind: "none" } },
    { source: "DOL", target: "date_of_loss", transform: { kind: "date", order: "DMY" } },
    { source: "Pd", target: "paid_to_date", transform: { kind: "amount" } },
  ],
};

describe("layout changes", () => {
  it("hashes headers independent of order, case and spacing", () => {
    expect(headersHash(["Clm No", "DOL"])).toBe(headersHash(["dol", " clm  no "]));
    expect(headersHash(["Clm No", "DOL"])).not.toBe(headersHash(["Clm No", "DOL", "Pd"]));
  });

  it("carries known columns over and asks only about the renamed one", () => {
    const headers = ["DOL", "Paid TD", "Clm No", "Pol No"];
    const diff = diffLayout(saved, headers);
    expect(diff).toEqual({ matched: ["DOL", "Clm No", "Pol No"], added: ["Paid TD"], removed: ["Pd"] });
    expect(isLayoutRevision(diff, headers)).toBe(true);
    const next = carryOver(saved, headers, [{ source: "Paid TD", target: "paid_to_date", transform: { kind: "amount" } }]);
    expect(next.columns.map((c) => [c.source, c.target])).toEqual([
      ["DOL", "date_of_loss"],
      ["Paid TD", "paid_to_date"],
      ["Clm No", "claim_ref"],
      ["Pol No", "policy_ref"],
    ]);
  });

  it("treats a mostly unfamiliar file as a new layout, not a revision", () => {
    const headers = ["Claim Number", "Policy No", "Loss", "Advised", "Cause"];
    expect(isLayoutRevision(diffLayout(saved, headers), headers)).toBe(false);
  });
});

describe("checkMapping", () => {
  it("rejects double-mapped and missing required fields", () => {
    const m: Mapping = { columns: [...saved.columns, { source: "Ref", target: "claim_ref", transform: { kind: "none" } }] };
    expect(checkMapping(m, "claim")).toEqual(['"Ref" and "Clm No" both map to claim_ref']);
    expect(checkMapping({ columns: saved.columns.slice(1) }, "claim")).toEqual(["Required field claim_ref is not mapped"]);
  });
});

describe("transforms", () => {
  it.each([
    ["25/07/2026", "DMY", "2026-07-25"],
    ["07/25/2026", "MDY", "2026-07-25"],
    ["25/07/26", "DMY", "2026-07-25"],
    ["2026-07-25", "DMY", "2026-07-25"],
    [46228, "DMY", "2026-07-25"],
  ] as const)("parses %s as %s", (raw, order, iso) => {
    expect(parseDate(raw, order)).toEqual({ ok: true, value: iso });
  });

  it("rejects impossible dates rather than rolling them over", () => {
    expect(parseDate("31/02/2026", "DMY").ok).toBe(false);
    expect(parseDate("07/25/2026", "DMY").ok).toBe(false);
  });

  it.each([
    ["£1,200.00", 1200, "GBP"],
    ["-£150.00", -150, "GBP"],
    ["(1,234.50)", -1234.5, undefined],
    ["EUR 99.9", 99.9, "EUR"],
    ["1200", 1200, undefined],
  ] as const)("parses amount %s", (raw, value, currency) => {
    expect(parseAmount(raw)).toEqual({ ok: true, value, currency });
  });

  it("rejects a typo'd amount", () => {
    expect(parseAmount("£1,2O0.00").ok).toBe(false);
  });
});
