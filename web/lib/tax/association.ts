/**
 * Associated company counting — CTA 2010 s.18E / s.18F.
 *
 * The rules that make this non-obvious, and which the tests pin down:
 *
 *  1. The disregard is NOT "dormant". s.18E(3) disregards a company that "has
 *     not carried on a trade or business at any time in the accounting period".
 *     Companies Act dormancy (CA 2006 s.1169) is a different test for a
 *     different purpose and the two diverge routinely.
 *
 *  2. Bank interest alone is not a business — Jowett v O'Neill & Brennan
 *     Construction [1998] STC 482. Note GOV.UK's separate "active for
 *     Corporation Tax" guidance says the opposite for ITS purpose. Different
 *     tests. Do not conflate them.
 *
 *  3. NO APPORTIONMENT. s.18E(1)-(2): associated for any part of the period
 *     means associated for the whole of it. CTM03956. One day of trading in an
 *     otherwise inactive company halves the limits for the entire period,
 *     retrospectively.
 *
 *  4. The period tested is the SUBJECT company's accounting period, not the
 *     associate's own year end.
 *
 *  5. s.18F passive holding companies are also disregarded — six cumulative
 *     conditions, narrow. Failing s.18F does not make a company an associate;
 *     the ordinary Jowett non-business argument still stands.
 *
 * Association itself (common control, substantial commercial interdependence)
 * is a JUDGEMENT recorded by the user, not computed here. This module consumes
 * that determination; it does not make it.
 */

export type ActivityBasis =
  | 'no_activity'
  | 'bank_interest_only'
  | 's18F_passive_holding'
  | 'trading';

export interface CandidateAssociate {
  entityId: string;
  name: string;
  /**
   * Did this company carry on a trade or business at ANY time during the
   * subject company's accounting period? The user records this per period with
   * reasoning; it is not inferred from a status flag.
   */
  carriedOnTradeOrBusiness: boolean;
  basis: ActivityBasis;
  /** The date activity began, where it broke the disregard mid-period. */
  firstActivityDate?: Date;
  reasoning: string;
}

export interface AssociationCount {
  /** Divisor for the CT limits: the subject company plus counted associates. */
  divisor: number;
  counted: CandidateAssociate[];
  disregarded: { associate: CandidateAssociate; reason: string }[];
  workings: string[];
}

/**
 * Count associates for a subject company's accounting period.
 *
 * `candidates` are the companies the user has determined to be under common
 * control (or otherwise associated) at any time in the period — the
 * determination is an input, not something this function decides.
 */
export function countAssociates(candidates: CandidateAssociate[]): AssociationCount {
  const counted: CandidateAssociate[] = [];
  const disregarded: { associate: CandidateAssociate; reason: string }[] = [];
  const workings: string[] = [];

  for (const c of candidates) {
    if (!c.carriedOnTradeOrBusiness) {
      const reason =
        c.basis === 's18F_passive_holding'
          ? 'Disregarded under CTA 2010 s.18F — passive holding company (CTM03945)'
          : c.basis === 'bank_interest_only'
            ? 'Disregarded under CTA 2010 s.18E(3) — bank interest alone is not a business (Jowett v O’Neill & Brennan)'
            : 'Disregarded under CTA 2010 s.18E(3) — no trade or business at any time in the period';
      disregarded.push({ associate: c, reason });
      workings.push(`${c.name}: ${reason}. Basis recorded: ${c.reasoning}`);
      continue;
    }

    counted.push(c);
    const timing = c.firstActivityDate
      ? ` Activity began ${c.firstActivityDate.toISOString().slice(0, 10)}, but s.18E(1) counts the WHOLE period — no apportionment (CTM03956).`
      : '';
    workings.push(
      `${c.name}: counted as an associated company.${timing} Basis recorded: ${c.reasoning}`,
    );
  }

  const divisor = 1 + counted.length;
  workings.push(
    `Divisor = 1 (subject company) + ${counted.length} associated = ${divisor} (CTM03935).`,
  );

  return { divisor, counted, disregarded, workings };
}

/**
 * What would happen if an inactive company started trading on a given date,
 * within a given accounting period?
 *
 * This is the "trade-start trap" what-if. Because there is no apportionment,
 * ANY start date falling inside the period contaminates the whole period. The
 * only way to avoid it is to start on or after the start of the NEXT period.
 */
export interface TradeStartImpact {
  contaminatesPeriod: boolean;
  /** Divisor that would apply to the subject company for this whole period. */
  divisorIfStarted: number;
  divisorIfNotStarted: number;
  firstSafeStartDate: Date;
  explanation: string;
}

export function assessTradeStart(args: {
  periodStart: Date;
  periodEnd: Date;
  proposedStartDate: Date;
  currentCandidates: CandidateAssociate[];
  startingEntityId: string;
}): TradeStartImpact {
  const { periodStart, periodEnd, proposedStartDate, currentCandidates, startingEntityId } = args;

  const base = countAssociates(currentCandidates);
  const withStart = countAssociates(
    currentCandidates.map((c) =>
      c.entityId === startingEntityId
        ? { ...c, carriedOnTradeOrBusiness: true, basis: 'trading' as const, firstActivityDate: proposedStartDate }
        : c,
    ),
  );

  const contaminates = proposedStartDate >= periodStart && proposedStartDate <= periodEnd;

  // The next period is assumed to begin the day after this one ends.
  const firstSafeStartDate = new Date(periodEnd.getTime() + 24 * 60 * 60 * 1000);

  const explanation = contaminates
    ? `Starting to trade on ${proposedStartDate.toISOString().slice(0, 10)} falls inside the accounting period ` +
      `${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}. Under CTA 2010 s.18E(1) ` +
      `the company is associated for the WHOLE period, so the limits are divided by ${withStart.divisor} for the entire ` +
      `period rather than ${base.divisor}. There is no apportionment (CTM03956). The first start date that leaves this ` +
      `period unaffected is ${firstSafeStartDate.toISOString().slice(0, 10)}.`
    : `Starting to trade on ${proposedStartDate.toISOString().slice(0, 10)} falls outside the accounting period, so this ` +
      `period is unaffected and the divisor remains ${base.divisor}.`;

  return {
    contaminatesPeriod: contaminates,
    divisorIfStarted: contaminates ? withStart.divisor : base.divisor,
    divisorIfNotStarted: base.divisor,
    firstSafeStartDate,
    explanation,
  };
}
