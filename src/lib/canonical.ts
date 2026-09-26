// The canonical schema every insurer's bordereau is mapped onto.
// Mapping, validation, the DB schema and the report all key off these names.

export type FileKind = "policy" | "claim";

export type FieldType = "string" | "date" | "amount" | "currency" | "claim_status";

export interface CanonicalField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  description: string;
}

export const POLICY_FIELDS: CanonicalField[] = [
  { name: "policy_ref", label: "Policy reference", type: "string", required: true, description: "Unique policy / certificate number" },
  { name: "insured_name", label: "Insured name", type: "string", required: false, description: "Name of the insured person" },
  { name: "inception_date", label: "Inception date", type: "date", required: true, description: "Cover start date" },
  { name: "expiry_date", label: "Expiry date", type: "date", required: true, description: "Cover end date" },
  { name: "product", label: "Product", type: "string", required: false, description: "Product or plan name" },
  { name: "destination", label: "Destination", type: "string", required: false, description: "Travel destination" },
  { name: "sum_insured", label: "Sum insured", type: "amount", required: false, description: "Maximum cover amount" },
  { name: "gross_premium", label: "Gross premium", type: "amount", required: false, description: "Premium charged to the insured" },
  { name: "currency", label: "Currency", type: "currency", required: false, description: "ISO 4217 currency code" },
];

export const CLAIM_FIELDS: CanonicalField[] = [
  { name: "claim_ref", label: "Claim reference", type: "string", required: true, description: "Unique claim number" },
  { name: "policy_ref", label: "Policy reference", type: "string", required: true, description: "Policy the claim is made under" },
  { name: "date_of_loss", label: "Date of loss", type: "date", required: true, description: "Date the loss occurred" },
  { name: "date_notified", label: "Date notified", type: "date", required: false, description: "Date the claim was first notified" },
  { name: "status", label: "Status", type: "claim_status", required: false, description: "open, closed or reopened" },
  { name: "cause", label: "Cause", type: "string", required: false, description: "Cause or description of loss" },
  { name: "paid_this_month", label: "Paid this month", type: "amount", required: false, description: "Amount paid during the reporting month" },
  { name: "paid_to_date", label: "Paid to date", type: "amount", required: false, description: "Cumulative amount paid" },
  { name: "reserve_movement", label: "Reserve movement", type: "amount", required: false, description: "New reserves plus reserve changes in the month (change in incurred)" },
  { name: "outstanding_reserve", label: "Outstanding reserve", type: "amount", required: false, description: "Reserve outstanding at month end" },
  { name: "currency", label: "Currency", type: "currency", required: false, description: "ISO 4217 currency code" },
];

export function fieldsFor(kind: FileKind): CanonicalField[] {
  return kind === "policy" ? POLICY_FIELDS : CLAIM_FIELDS;
}

export type ClaimStatus = "open" | "closed" | "reopened";

export interface PolicyRecord {
  policy_ref: string | null;
  insured_name: string | null;
  inception_date: string | null; // ISO yyyy-mm-dd
  expiry_date: string | null;
  product: string | null;
  destination: string | null;
  sum_insured: number | null;
  gross_premium: number | null;
  currency: string | null;
}

export interface ClaimRecord {
  claim_ref: string | null;
  policy_ref: string | null;
  date_of_loss: string | null;
  date_notified: string | null;
  status: ClaimStatus | null;
  cause: string | null;
  paid_this_month: number | null;
  paid_to_date: number | null;
  reserve_movement: number | null;
  outstanding_reserve: number | null;
  currency: string | null;
}
