// Plain-code validation. Each rule is a pure function from mapped rows (plus context) to issues.
import type { ClaimRecord, PolicyRecord } from "./canonical";
import { RULES, type Issue, type Rule } from "./issues";
import type { MappedRow } from "./mapping";

type Row<T> = MappedRow<T>;

function issue<T>(row: Row<T>, rule: Rule, field: string | null, message: string): Issue {
  return {
    rule,
    severity: RULES[rule].severity,
    sourceRow: row.sourceRow,
    sourceColumn: field ? (row.sourceColumns[field] ?? null) : null,
    message,
  };
}

const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------- policies

export interface PolicyContext {
  /** policy refs already loaded for this insurer from other imports */
  existingRefs: Set<string>;
}

type PolicyRule = (rows: Row<PolicyRecord>[], ctx: PolicyContext) => Issue[];

const policyRequired: PolicyRule = (rows) =>
  rows.flatMap((r) =>
    (["policy_ref", "inception_date", "expiry_date"] as const)
      .filter((f) => r.record[f] === null && !r.unparsed.includes(f))
      .map((f) => issue(r, "missing_required", f, `${f} is missing`)),
  );

const policyDates: PolicyRule = (rows) =>
  rows.flatMap((r) => {
    const { inception_date: i, expiry_date: e } = r.record;
    return i && e && e < i ? [issue(r, "expiry_before_inception", "expiry_date", `Expiry ${e} is before inception ${i}`)] : [];
  });

const policyDuplicates: PolicyRule = (rows, ctx) => {
  const seen = new Map<string, number>();
  const out: Issue[] = [];
  for (const r of rows) {
    const ref = r.record.policy_ref;
    if (!ref) continue;
    if (seen.has(ref)) out.push(issue(r, "duplicate_policy_ref", "policy_ref", `${ref} already appears on row ${seen.get(ref)}`));
    else if (ctx.existingRefs.has(ref)) out.push(issue(r, "duplicate_policy_ref", "policy_ref", `${ref} was already loaded from an earlier bordereau`));
    else seen.set(ref, r.sourceRow);
  }
  return out;
};

export const POLICY_RULES: PolicyRule[] = [policyRequired, policyDates, policyDuplicates];

export function validatePolicies(rows: Row<PolicyRecord>[], ctx: PolicyContext): Issue[] {
  return POLICY_RULES.flatMap((rule) => rule(rows, ctx));
}

// ---------------------------------------------------------------- claims

export interface ClaimContext {
  /** valid policies for this insurer, by ref */
  policies: Map<string, PolicyRecord>;
  /** last day of the reporting month, ISO; later dates are "in the future" */
  asOf: string;
}

type ClaimRule = (rows: Row<ClaimRecord>[], ctx: ClaimContext) => Issue[];

const claimRequired: ClaimRule = (rows) =>
  rows.flatMap((r) =>
    (["claim_ref", "policy_ref", "date_of_loss"] as const)
      .filter((f) => r.record[f] === null && !r.unparsed.includes(f))
      .map((f) => issue(r, "missing_required", f, `${f} is missing`)),
  );

const claimFutureDates: ClaimRule = (rows, ctx) =>
  rows.flatMap((r) =>
    (["date_of_loss", "date_notified"] as const)
      .filter((f) => r.record[f] !== null && r.record[f]! > ctx.asOf)
      .map((f) => issue(r, "future_date", f, `${f} ${r.record[f]} is after the reporting period end ${ctx.asOf}`)),
  );

const claimDuplicates: ClaimRule = (rows) => {
  const seen = new Map<string, number>();
  const out: Issue[] = [];
  for (const r of rows) {
    const ref = r.record.claim_ref;
    if (!ref) continue;
    if (seen.has(ref)) out.push(issue(r, "duplicate_claim_ref", "claim_ref", `${ref} already appears on row ${seen.get(ref)}`));
    else seen.set(ref, r.sourceRow);
  }
  return out;
};

const claimPolicyTies: ClaimRule = (rows, ctx) =>
  rows.flatMap((r) => {
    const { policy_ref, date_of_loss, paid_to_date, currency } = r.record;
    if (!policy_ref) return [];
    const p = ctx.policies.get(policy_ref);
    if (!p) return [issue(r, "orphan_claim", "policy_ref", `Policy ${policy_ref} does not exist`)];
    const out: Issue[] = [];
    if (date_of_loss && p.inception_date && p.expiry_date && (date_of_loss < p.inception_date || date_of_loss > p.expiry_date)) {
      out.push(issue(r, "loss_outside_cover", "date_of_loss", `Loss on ${date_of_loss} is outside cover ${p.inception_date} to ${p.expiry_date}`));
    }
    if (paid_to_date !== null && p.sum_insured !== null && paid_to_date > p.sum_insured) {
      out.push(issue(r, "paid_exceeds_sum_insured", "paid_to_date", `Paid ${fmt(paid_to_date)} exceeds sum insured ${fmt(p.sum_insured)}`));
    }
    if (currency && p.currency && currency !== p.currency) {
      out.push(issue(r, "currency_mismatch", "currency", `Claim is in ${currency}, policy is in ${p.currency}`));
    }
    return out;
  });

const claimNotification: ClaimRule = (rows) =>
  rows.flatMap((r) => {
    const { date_of_loss: l, date_notified: n } = r.record;
    return l && n && n < l ? [issue(r, "notified_before_loss", "date_notified", `Notified ${n} before loss ${l}`)] : [];
  });

const claimReserves: ClaimRule = (rows) =>
  rows.flatMap((r) =>
    r.record.outstanding_reserve !== null && r.record.outstanding_reserve < 0
      ? [issue(r, "negative_reserve", "outstanding_reserve", `Outstanding reserve is ${fmt(r.record.outstanding_reserve)}`)]
      : [],
  );

export const CLAIM_RULES: ClaimRule[] = [claimRequired, claimFutureDates, claimDuplicates, claimPolicyTies, claimNotification, claimReserves];

export function validateClaims(rows: Row<ClaimRecord>[], ctx: ClaimContext): Issue[] {
  return CLAIM_RULES.flatMap((rule) => rule(rows, ctx));
}

/** Rows with any error-level issue are quarantined; the rest load. */
export function partition<T>(rows: Row<T>[], issues: Issue[]): { load: Row<T>[]; quarantined: Row<T>[] } {
  const bad = new Set(issues.filter((i) => i.severity === "error").map((i) => i.sourceRow));
  return { load: rows.filter((r) => !bad.has(r.sourceRow)), quarantined: rows.filter((r) => bad.has(r.sourceRow)) };
}
