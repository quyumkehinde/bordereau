// Planted errors. Each helper inserts one bad row into a file's rows and tags it with the issue(s)
// validation must raise for it. Planted claims never take part in the month-to-month lifecycle, so
// quarantining them can't disturb movement reconciliation.
import { addDays, daysBetween, monthEnd, monthStart } from "../../src/lib/dates";
import type { ClaimRow, PolicyRow } from "./layouts";
import { newClaim, type GenClaim, type GenPolicy, type Portfolio } from "./portfolio";
import type { Rng } from "./rng";

export interface PlantContext {
  rng: Rng;
  month: string;
  portfolio: Portfolio;
  /** clean policies loaded by the end of this month */
  inForce: GenPolicy[];
  policyRef: (n: number) => string;
  claimRef: (n: number) => string;
}

function insert<T>(rng: Rng, rows: T[], row: T, after = -1) {
  rows.splice(rng.int(after + 1, rows.length), 0, row);
}

function genuineIndex<T extends { plants: unknown[] }>(rng: Rng, rows: T[]): number {
  const idx = rows.map((r, i) => (r.plants.length === 0 ? i : -1)).filter((i) => i >= 0);
  return rng.pick(idx);
}

function freshPolicy(ctx: PlantContext, month = ctx.month): GenPolicy {
  const template = ctx.rng.pick(ctx.portfolio.policies[month]);
  return { ...template, policy_ref: ctx.policyRef(ctx.portfolio.nextPolicyNo()) };
}

/** A clean claim on an in-force policy with a loss this month (before any corruption). */
function freshClaim(ctx: PlantContext, filter: (p: GenPolicy) => boolean = () => true): { claim: GenClaim; policy: GenPolicy } {
  const start = monthStart(ctx.month);
  const end = monthEnd(ctx.month);
  const eligible = ctx.inForce.filter((p) => p.inception_date <= addDays(end, -3) && p.expiry_date >= addDays(start, 2) && filter(p));
  const policy = ctx.rng.pick(eligible);
  const from = policy.inception_date > start ? policy.inception_date : start;
  const to = policy.expiry_date < addDays(end, -1) ? policy.expiry_date : addDays(end, -1);
  const loss = addDays(from, ctx.rng.int(0, daysBetween(from, to)));
  const notified = addDays(loss, ctx.rng.int(0, daysBetween(loss, end)));
  return { claim: newClaim(ctx.rng, policy, ctx.claimRef(ctx.portfolio.nextClaimNo()), loss, notified), policy };
}

// ---------------------------------------------------------------- policies

export const plantPolicy = {
  duplicate(ctx: PlantContext, rows: PolicyRow[]) {
    const i = genuineIndex(ctx.rng, rows);
    const orig = rows[i].v;
    insert(ctx.rng, rows, {
      v: { ...orig, gross_premium: (orig.gross_premium ?? 0) + 500 },
      plants: [{ rule: "duplicate_policy_ref", field: "policy_ref", note: `second row for ${orig.policy_ref}` }],
    }, i);
  },

  duplicateFromEarlierMonth(ctx: PlantContext, rows: PolicyRow[], earlierMonth: string) {
    const earlier = ctx.rng.pick(ctx.portfolio.policies[earlierMonth]);
    const p = freshPolicy(ctx);
    insert(ctx.rng, rows, {
      v: { ...p, policy_ref: earlier.policy_ref },
      plants: [{ rule: "duplicate_policy_ref", field: "policy_ref", note: `${earlier.policy_ref} was already sent in ${earlierMonth}` }],
    });
  },

  missingRef(ctx: PlantContext, rows: PolicyRow[]) {
    insert(ctx.rng, rows, {
      v: { ...freshPolicy(ctx), policy_ref: null },
      plants: [{ rule: "missing_required", field: "policy_ref", note: "policy ref left blank" }],
    });
  },

  badDate(ctx: PlantContext, rows: PolicyRow[]) {
    insert(ctx.rng, rows, {
      v: freshPolicy(ctx),
      corrupt: { field: "inception_date", kind: "date" },
      plants: [{ rule: "unparseable_date", field: "inception_date", note: "31 February" }],
    });
  },

  badAmount(ctx: PlantContext, rows: PolicyRow[]) {
    insert(ctx.rng, rows, {
      v: freshPolicy(ctx),
      corrupt: { field: "sum_insured", kind: "amount" },
      plants: [{ rule: "unparseable_amount", field: "sum_insured", note: "letter O typed for a zero" }],
    });
  },

  expiryBeforeInception(ctx: PlantContext, rows: PolicyRow[]) {
    const p = freshPolicy(ctx);
    insert(ctx.rng, rows, {
      v: { ...p, expiry_date: addDays(p.inception_date, -5) },
      plants: [{ rule: "expiry_before_inception", field: "expiry_date", note: "dates swapped" }],
    });
  },
};

// ---------------------------------------------------------------- claims

export const plantClaim = {
  duplicate(ctx: PlantContext, rows: ClaimRow[]) {
    const i = genuineIndex(ctx.rng, rows);
    const orig = rows[i].v;
    insert(ctx.rng, rows, {
      v: { ...orig },
      plants: [{ rule: "duplicate_claim_ref", field: "claim_ref", note: `second row for ${orig.claim_ref}` }],
    }, i);
  },

  orphan(ctx: PlantContext, rows: ClaimRow[]) {
    const { claim } = freshClaim(ctx);
    const ghost = ctx.policyRef(990000 + ctx.rng.int(0, 9999));
    insert(ctx.rng, rows, {
      v: { ...claim, policy_ref: ghost },
      plants: [{ rule: "orphan_claim", field: "policy_ref", note: `${ghost} was never sent` }],
    });
  },

  lossBeforeCover(ctx: PlantContext, rows: ClaimRow[]) {
    const start = monthStart(ctx.month);
    const { claim, policy } = freshClaim(ctx, (p) => p.inception_date >= addDays(start, 5) && p.inception_date <= monthEnd(ctx.month));
    const loss = addDays(policy.inception_date, -3);
    insert(ctx.rng, rows, {
      v: { ...claim, date_of_loss: loss, date_notified: addDays(policy.inception_date, -1) },
      plants: [{ rule: "loss_outside_cover", field: "date_of_loss", note: `loss 3 days before cover starts ${policy.inception_date}` }],
    });
  },

  paidOverSumInsured(ctx: PlantContext, rows: ClaimRow[]) {
    const { claim, policy } = freshClaim(ctx);
    const paid = policy.sum_insured + 50_000;
    insert(ctx.rng, rows, {
      v: { ...claim, status: "closed", paid_this_month: paid, paid_to_date: paid, reserve_movement: paid, outstanding_reserve: 0 },
      plants: [{ rule: "paid_exceeds_sum_insured", field: "paid_to_date", note: "paid £500 over the limit" }],
    });
  },

  negativeReserve(ctx: PlantContext, rows: ClaimRow[]) {
    const { claim } = freshClaim(ctx);
    insert(ctx.rng, rows, {
      v: { ...claim, status: "open", outstanding_reserve: -15_000 },
      plants: [{ rule: "negative_reserve", field: "outstanding_reserve", note: "reserve keyed as negative" }],
    });
  },

  notifiedBeforeLoss(ctx: PlantContext, rows: ClaimRow[]) {
    const start = monthStart(ctx.month);
    // In force from the 1st, so moving the loss to the 3rd can't take it outside cover.
    const { claim } = freshClaim(ctx, (p) => p.inception_date <= start && p.expiry_date >= addDays(start, 5));
    const loss = claim.date_of_loss < addDays(start, 3) ? addDays(start, 3) : claim.date_of_loss;
    insert(ctx.rng, rows, {
      v: { ...claim, date_of_loss: loss, date_notified: addDays(loss, -2) },
      plants: [{ rule: "notified_before_loss", field: "date_notified", note: "notification two days before the loss" }],
    });
  },

  futureLoss(ctx: PlantContext, rows: ClaimRow[]) {
    const target = addDays(monthEnd(ctx.month), 10);
    const { claim } = freshClaim(ctx, (p) => p.expiry_date >= target);
    insert(ctx.rng, rows, {
      v: { ...claim, date_of_loss: target, date_notified: null },
      plants: [{ rule: "future_date", field: "date_of_loss", note: "loss dated after the reporting period" }],
    });
  },

  missingClaimRef(ctx: PlantContext, rows: ClaimRow[]) {
    const { claim } = freshClaim(ctx);
    insert(ctx.rng, rows, {
      v: { ...claim, claim_ref: null },
      plants: [{ rule: "missing_required", field: "claim_ref", note: "claim ref left blank" }],
    });
  },

  missingPolicyRef(ctx: PlantContext, rows: ClaimRow[]) {
    const { claim } = freshClaim(ctx);
    insert(ctx.rng, rows, {
      v: { ...claim, policy_ref: null },
      plants: [{ rule: "missing_required", field: "policy_ref", note: "policy ref left blank" }],
    });
  },

  currencyMismatch(ctx: PlantContext, rows: ClaimRow[]) {
    const { claim } = freshClaim(ctx);
    insert(ctx.rng, rows, {
      v: { ...claim, currency: "EUR" },
      plants: [{ rule: "currency_mismatch", field: "currency", note: "claim in EUR on a GBP policy" }],
    });
  },
};
