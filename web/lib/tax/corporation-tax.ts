/**
 * Corporation tax computation — CTA 2010 Part 3 Ch 3A.
 *
 * Marginal relief (CTM03925):
 *
 *     MR = F × (U − A) × (N ÷ A)
 *
 *     F = standard fraction, 3/200
 *     U = upper limit, after division by associates and short-period proration
 *     A = augmented profits (taxable total profits + non-group distributions)
 *     N = taxable total profits
 *
 * Where no distributions are received N = A and this collapses to (U − A) × F.
 *
 * Close investment-holding companies (CTA 2010 s.34) are denied the small
 * profits rate outright — main rate on all profits, whatever the limits say.
 */

import { corporationTaxRates } from './rates.js';

export interface CtComputationInput {
  periodStart: Date;
  periodEnd: Date;
  /** Taxable total profits — N in the marginal relief formula. */
  taxableTotalProfits: number;
  /** Non-group distributions received. A = TTP + this. */
  distributionsReceived?: number;
  /** From countAssociates(): 1 + number of counted associated companies. */
  associationDivisor: number;
  /** CTA 2010 s.34 — denied the small profits rate entirely. */
  isCloseInvestmentHoldingCompany?: boolean;
}

export interface CtComputationResult {
  taxableTotalProfits: number;
  augmentedProfits: number;
  lowerLimit: number;
  upperLimit: number;
  daysInPeriod: number;
  rateApplied: 'small_profits' | 'marginal' | 'main';
  taxAtMainRate: number;
  marginalRelief: number;
  taxDue: number;
  effectiveRate: number;
  qipThreshold: number;
  qipApplies: boolean;
  veryLargeThreshold: number;
  veryLargeApplies: boolean;
  workings: string[];
}

const DAY = 24 * 60 * 60 * 1000;

function daysBetweenInclusive(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY) + 1;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeCorporationTax(input: CtComputationInput): CtComputationResult {
  const {
    periodStart,
    periodEnd,
    taxableTotalProfits: N,
    distributionsReceived = 0,
    associationDivisor,
    isCloseInvestmentHoldingCompany = false,
  } = input;

  if (associationDivisor < 1) {
    throw new Error('associationDivisor must be at least 1 (the company itself)');
  }
  if (periodEnd < periodStart) {
    throw new Error('periodEnd must be on or after periodStart');
  }

  const rates = corporationTaxRates(periodEnd);
  const A = N + distributionsReceived;
  const workings: string[] = [];

  const days = daysBetweenInclusive(periodStart, periodEnd);
  // Proration for short accounting periods (CTM03930). 365 is the statutory
  // reference length; a 366-day period is not scaled up.
  const prorationFactor = days >= 365 ? 1 : days / 365;

  const lowerLimit = round2((rates.lowerLimit / associationDivisor) * prorationFactor);
  const upperLimit = round2((rates.upperLimit / associationDivisor) * prorationFactor);
  const qipThreshold = round2((rates.qipThreshold / associationDivisor) * prorationFactor);
  const veryLargeThreshold = round2((rates.veryLargeThreshold / associationDivisor) * prorationFactor);

  workings.push(
    `Taxable total profits (N) = £${N.toLocaleString()}; augmented profits (A) = £${A.toLocaleString()}.`,
  );
  workings.push(
    `Limits divided by ${associationDivisor} for associated companies (CTM03935)` +
      (prorationFactor < 1
        ? ` and prorated for a ${days}-day period (${days}/365, CTM03930)`
        : '') +
      `: lower £${lowerLimit.toLocaleString()}, upper £${upperLimit.toLocaleString()}.`,
  );

  let rateApplied: CtComputationResult['rateApplied'];
  let taxAtMainRate: number;
  let marginalRelief = 0;
  let taxDue: number;

  if (isCloseInvestmentHoldingCompany) {
    rateApplied = 'main';
    taxAtMainRate = round2(N * rates.mainRate);
    taxDue = taxAtMainRate;
    workings.push(
      `Close investment-holding company (CTA 2010 s.34): small profits rate and marginal relief denied. ` +
        `Main rate ${(rates.mainRate * 100).toFixed(0)}% on all profits.`,
    );
  } else if (A <= lowerLimit) {
    rateApplied = 'small_profits';
    taxAtMainRate = round2(N * rates.mainRate);
    taxDue = round2(N * rates.smallProfitsRate);
    workings.push(
      `Augmented profits £${A.toLocaleString()} do not exceed the lower limit, so the small profits rate ` +
        `of ${(rates.smallProfitsRate * 100).toFixed(0)}% applies: £${taxDue.toLocaleString()}.`,
    );
  } else if (A >= upperLimit) {
    rateApplied = 'main';
    taxAtMainRate = round2(N * rates.mainRate);
    taxDue = taxAtMainRate;
    workings.push(
      `Augmented profits £${A.toLocaleString()} reach the upper limit, so the main rate of ` +
        `${(rates.mainRate * 100).toFixed(0)}% applies with no marginal relief: £${taxDue.toLocaleString()}.`,
    );
  } else {
    rateApplied = 'marginal';
    taxAtMainRate = round2(N * rates.mainRate);
    // MR = F × (U − A) × (N ÷ A)
    marginalRelief = round2(rates.marginalReliefFraction * (upperLimit - A) * (N / A));
    taxDue = round2(taxAtMainRate - marginalRelief);
    workings.push(
      `Marginal relief: F × (U − A) × (N ÷ A) = (3/200) × (£${upperLimit.toLocaleString()} − ` +
        `£${A.toLocaleString()}) × (${N.toLocaleString()} ÷ ${A.toLocaleString()}) = £${marginalRelief.toLocaleString()}.`,
    );
    workings.push(
      `Tax at main rate £${taxAtMainRate.toLocaleString()} less marginal relief £${marginalRelief.toLocaleString()} ` +
        `= £${taxDue.toLocaleString()}.`,
    );
  }

  const qipApplies = A > qipThreshold;
  const veryLargeApplies = A > veryLargeThreshold;
  if (qipApplies) {
    workings.push(
      `Quarterly instalment payments apply: augmented profits exceed the divided threshold of ` +
        `£${qipThreshold.toLocaleString()}` +
        (associationDivisor > 1
          ? ` (£${rates.qipThreshold.toLocaleString()} ÷ ${associationDivisor})`
          : '') +
        `.`,
    );
  }

  return {
    taxableTotalProfits: N,
    augmentedProfits: A,
    lowerLimit,
    upperLimit,
    daysInPeriod: days,
    rateApplied,
    taxAtMainRate,
    marginalRelief,
    taxDue,
    effectiveRate: N === 0 ? 0 : round2((taxDue / N) * 10000) / 10000,
    qipThreshold,
    qipApplies,
    veryLargeThreshold,
    veryLargeApplies,
    workings,
  };
}

/** CT payment due date for a company not paying by instalments: 9 months and 1 day. */
export function ctPaymentDueDate(periodEnd: Date): Date {
  const d = new Date(periodEnd.getTime());
  d.setUTCMonth(d.getUTCMonth() + 9);
  d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** CT600 filing deadline: 12 months after the end of the accounting period. */
export function ct600FilingDueDate(periodEnd: Date): Date {
  const d = new Date(periodEnd.getTime());
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}
