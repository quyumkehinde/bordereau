// Builds a clean two-month portfolio for one insurer: policies written each month and a claims
// snapshot per month whose movements reconcile exactly. Planted errors are added separately.
import type { ClaimStatus } from "../../src/lib/canonical";
import { addDays, daysBetween, monthEnd, monthStart } from "../../src/lib/dates";
import type { BasePolicy } from "./base";
import type { Rng } from "./rng";

export interface GenPolicy {
  policy_ref: string;
  insured_name: string;
  inception_date: string;
  expiry_date: string;
  product: string;
  destination: string;
  sum_insured: number; // pence
  gross_premium: number; // pence
  currency: string;
  agency: string;
  channel: string;
  claimed: boolean; // base row had a claim; preferred when choosing claims
}

export interface GenClaim {
  claim_ref: string;
  policy_ref: string;
  date_of_loss: string;
  date_notified: string | null;
  status: ClaimStatus;
  cause: string;
  paid_this_month: number; // pence
  paid_to_date: number;
  reserve_movement: number;
  outstanding_reserve: number;
  currency: string;
  litigated: boolean;
}

export interface PortfolioConfig {
  currency: string;
  policiesPerMonth: number;
  newClaimsPerMonth: number;
  allowReopen: boolean;
  policyRef: (n: number) => string;
  claimRef: (n: number) => string;
}

export interface Portfolio {
  policies: Record<string, GenPolicy[]>;
  claims: Record<string, GenClaim[]>;
  nextPolicyNo: () => number;
  nextClaimNo: () => number;
}

const FIRST = ["Amelia", "Oliver", "Isla", "George", "Ava", "Noah", "Mia", "Arthur", "Grace", "Leo", "Freya", "Oscar", "Lily", "Harry", "Ella", "Jack", "Sophia", "Muhammad", "Chloe", "Theo", "Priya", "Wei", "Aisha", "Tomasz", "Chinedu", "Siobhan"];
const LAST = ["Smith", "Jones", "Taylor", "Brown", "Williams", "Wilson", "Johnson", "Davies", "Patel", "Robinson", "Wright", "Thompson", "Evans", "Walker", "White", "Roberts", "Green", "Hall", "Khan", "Lewis", "Okafor", "Chen", "Nowak", "Murphy", "Adeyemi", "Singh"];
export const CAUSES = ["Medical expenses", "Trip cancellation", "Baggage loss", "Travel delay", "Personal accident", "Missed departure", "Personal liability", "Repatriation", "Rental vehicle excess"];

/** Sum insured by product tier (the base dataset has no limits, so these are assumptions). */
function sumInsuredFor(product: string): number {
  const p = product.toLowerCase();
  if (p.includes("rental vehicle")) return 5_000;
  if (p.includes("cancellation")) return 7_500;
  if (p.includes("platinum") || p.includes("premier") || p.includes("gold")) return 50_000;
  if (p.includes("silver") || p.includes("comprehensive")) return 25_000;
  if (p.includes("bronze") || p.includes("basic") || p.includes("value")) return 10_000;
  return 15_000;
}

const roundTo = (pence: number, step: number) => Math.round(pence / step) * step;

export function buildPortfolio(rng: Rng, base: BasePolicy[], months: string[], cfg: PortfolioConfig): Portfolio {
  let policyNo = 0;
  let claimNo = 0;
  const nextPolicyNo = () => ++policyNo;
  const nextClaimNo = () => ++claimNo;

  const policies: Record<string, GenPolicy[]> = {};
  for (const month of months) {
    const start = monthStart(month);
    const days = daysBetween(start, monthEnd(month)) + 1;
    policies[month] = Array.from({ length: cfg.policiesPerMonth }, () => {
      const b = rng.pick(base);
      const inception = addDays(start, rng.int(0, days - 1));
      return {
        policy_ref: cfg.policyRef(nextPolicyNo()),
        insured_name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
        inception_date: inception,
        expiry_date: addDays(inception, b.durationDays - 1),
        product: b.product,
        destination: b.destination,
        sum_insured: sumInsuredFor(b.product) * 100,
        gross_premium: Math.round(b.netSales * 100),
        currency: cfg.currency,
        agency: b.agency,
        channel: b.channel,
        claimed: b.claimed,
      };
    }).sort((a, b) => a.policy_ref.localeCompare(b.policy_ref));
  }

  const claims: Record<string, GenClaim[]> = {};
  const claimedPolicies = new Set<string>();
  let previous: GenClaim[] = [];

  for (const [i, month] of months.entries()) {
    const end = monthEnd(month);
    const start = monthStart(month);
    const snapshot: GenClaim[] = [];

    // Carry forward every claim that was still open (or could reopen) last month.
    let reopened = false;
    for (const prev of previous) {
      if (prev.outstanding_reserve > 0) snapshot.push(developClaim(rng, prev));
      else if (cfg.allowReopen && !reopened) {
        reopened = true;
        const movement = roundTo(prev.paid_to_date * 0.25, 1000) || 10_000;
        snapshot.push({ ...prev, status: "reopened", paid_this_month: 0, reserve_movement: movement, outstanding_reserve: movement });
      }
    }

    // New claims: losses this month on policies in force this month.
    const inForce = months
      .slice(0, i + 1)
      .flatMap((m) => policies[m])
      .filter((p) => !claimedPolicies.has(p.policy_ref) && p.inception_date <= addDays(end, -2) && p.expiry_date >= start);
    const candidates = [...rng.shuffle(inForce.filter((p) => p.claimed)), ...rng.shuffle(inForce.filter((p) => !p.claimed))];
    for (const p of candidates.slice(0, cfg.newClaimsPerMonth)) {
      claimedPolicies.add(p.policy_ref);
      const from = p.inception_date > start ? p.inception_date : start;
      const to = p.expiry_date < addDays(end, -1) ? p.expiry_date : addDays(end, -1);
      const loss = addDays(from, rng.int(0, daysBetween(from, to)));
      const notified = addDays(loss, rng.int(0, Math.min(10, daysBetween(loss, end))));
      snapshot.push(newClaim(rng, p, cfg.claimRef(nextClaimNo()), loss, notified));
    }

    claims[month] = snapshot.sort((a, b) => a.claim_ref.localeCompare(b.claim_ref));
    previous = claims[month];
  }

  return { policies, claims, nextPolicyNo, nextClaimNo };
}

export function newClaim(rng: Rng, p: GenPolicy, ref: string, loss: string, notified: string | null): GenClaim {
  // Initial reserve up to 30% of the limit keeps paid-to-date well under the sum insured.
  const reserve = Math.max(10_000, roundTo(p.sum_insured * (0.02 + rng.next() * 0.28), 1000));
  const roll = rng.next();
  const paid = roll < 0.4 ? 0 : roll < 0.8 ? roundTo(reserve * (0.1 + rng.next() * 0.5), 100) : reserve;
  return {
    claim_ref: ref,
    policy_ref: p.policy_ref,
    date_of_loss: loss,
    date_notified: notified,
    status: paid === reserve ? "closed" : "open",
    cause: rng.pick(CAUSES),
    paid_this_month: paid,
    paid_to_date: paid,
    reserve_movement: reserve,
    outstanding_reserve: reserve - paid,
    currency: p.currency,
    litigated: rng.chance(0.08),
  };
}

/** Next month's row for an open claim: outstanding' = outstanding + movement - paid. */
function developClaim(rng: Rng, prev: GenClaim): GenClaim {
  const os = prev.outstanding_reserve;
  const movement = rng.chance(0.5) ? 0 : roundTo(os * (-0.2 + rng.next() * 0.6), 1000);
  const available = os + movement;
  const settle = rng.chance(0.35);
  const paid = settle ? available : rng.chance(0.4) ? 0 : roundTo(available * (0.1 + rng.next() * 0.5), 100);
  const outstanding = available - paid;
  return {
    ...prev,
    status: outstanding === 0 ? "closed" : prev.status === "reopened" ? "reopened" : "open",
    paid_this_month: paid,
    paid_to_date: prev.paid_to_date + paid,
    reserve_movement: movement,
    outstanding_reserve: outstanding,
  };
}
