export type Severity = "error" | "warning";

export const RULES = {
  missing_required: { severity: "error", label: "Required field missing" },
  unparseable_date: { severity: "error", label: "Unparseable date" },
  unparseable_amount: { severity: "error", label: "Unparseable amount" },
  unparseable_currency: { severity: "error", label: "Unparseable currency" },
  unknown_value: { severity: "error", label: "Unrecognised value" },
  future_date: { severity: "error", label: "Date in the future" },
  expiry_before_inception: { severity: "error", label: "Expiry before inception" },
  duplicate_policy_ref: { severity: "error", label: "Duplicate policy ref" },
  duplicate_claim_ref: { severity: "error", label: "Duplicate claim ref" },
  orphan_claim: { severity: "error", label: "Claim on unknown policy" },
  loss_outside_cover: { severity: "error", label: "Loss outside cover period" },
  notified_before_loss: { severity: "error", label: "Notified before loss" },
  negative_reserve: { severity: "error", label: "Negative reserve" },
  paid_exceeds_sum_insured: { severity: "warning", label: "Paid exceeds sum insured" },
  currency_mismatch: { severity: "error", label: "Currency differs from policy" },
} as const satisfies Record<string, { severity: Severity; label: string }>;

export type Rule = keyof typeof RULES;

export interface Issue {
  rule: Rule;
  severity: Severity;
  sourceRow: number;
  sourceColumn: string | null;
  message: string;
}
