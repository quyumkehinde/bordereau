// Lloyd's Coverholder Reporting Standards v5.2: claims bordereau fields (travel / A&H subset).
//
// PROVISIONAL. These names and their order must be confirmed against the London Market Group
// glossary export (glossary.londonmarketgroup.co.uk) before this report is used for anything real.
// When the export is in hand, replace CRS_CLAIM_FIELDS below; nothing else depends on the labels.
import type { ClaimRecord, PolicyRecord } from "./canonical";
import { monthEnd } from "./dates";

export const CRS_VERSION = "5.2";
export const CRS_FIELDS_CONFIRMED = false;

export type CrsKind = "text" | "date" | "money";

export interface CrsField {
  name: string;
  kind: CrsKind;
  value: (c: ClaimRecord, p: PolicyRecord | undefined, month: string) => string | number | null;
}

const incurred = (c: ClaimRecord) => (c.paid_to_date ?? 0) + (c.outstanding_reserve ?? 0);
const previouslyPaid = (c: ClaimRecord) => (c.paid_to_date ?? 0) - (c.paid_this_month ?? 0);
const STATUS: Record<string, string> = { open: "Open", closed: "Closed", reopened: "Re-opened" };

export const CRS_CLAIM_FIELDS: CrsField[] = [
  { name: "Reporting Period (End Date)", kind: "date", value: (_c, _p, month) => monthEnd(month) },
  { name: "Certificate Reference", kind: "text", value: (c) => c.policy_ref },
  { name: "Claim Reference", kind: "text", value: (c) => c.claim_ref },
  { name: "Insured Full Name or Company Name", kind: "text", value: (_c, p) => p?.insured_name ?? null },
  { name: "Risk Inception Date", kind: "date", value: (_c, p) => p?.inception_date ?? null },
  { name: "Risk Expiry Date", kind: "date", value: (_c, p) => p?.expiry_date ?? null },
  { name: "Date of Loss", kind: "date", value: (c) => c.date_of_loss },
  { name: "Date Claim First Advised", kind: "date", value: (c) => c.date_notified },
  { name: "Claim Status", kind: "text", value: (c) => (c.status ? STATUS[c.status] : null) },
  { name: "Loss Description", kind: "text", value: (c) => c.cause },
  { name: "Original Currency", kind: "text", value: (c) => c.currency },
  { name: "Paid this month - Indemnity", kind: "money", value: (c) => c.paid_this_month ?? 0 },
  { name: "Previously Paid - Indemnity", kind: "money", value: (c) => previouslyPaid(c) },
  { name: "Reserve - Indemnity", kind: "money", value: (c) => c.outstanding_reserve ?? 0 },
  { name: "Total Incurred - Indemnity", kind: "money", value: (c) => incurred(c) },
];

/** Report columns whose totals verify checks against the underlying claim rows. */
export const CRS_TOTAL_CHECKS = {
  paidThisMonth: "Paid this month - Indemnity",
  outstanding: "Reserve - Indemnity",
  incurred: "Total Incurred - Indemnity",
} as const;
