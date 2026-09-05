/**
 * Capital gains tax.
 *
 * Rates are selected by DISPOSAL DATE, never by current year — main rates rose
 * 10/20 → 18/24 on 30 October 2024, and BADR ran 10% → 14% (6 April 2025) →
 * 18% (6 April 2026). A disposal in an earlier year uses that year's rates.
 *
 * BADR qualification is a monitoring problem, not a transaction problem: every
 * condition must hold for a FULL 2 YEARS in the person's own right. Transferring
 * shares to a spouse shortly before a sale achieves nothing — the clock runs on
 * the person, not on the shares.
 */

import { cgtRates, type TaxYear } from './rates.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface Disposal {
  id: string;
  description: string;
  assetClass: 'shares' | 'residential_property' | 'other_property' | 'other';
  disposedOn: Date;
  acquiredOn?: Date;
  proceeds: number;
  baseCost: number;
  costsOfDisposal?: number;
  claimBadr?: boolean;
}

export interface CgtResult {
  gains: { disposal: Disposal; gain: number }[];
  totalGains: number;
  annualExemptAmount: number;
  taxableGains: number;
  badrGains: number;
  badrTax: number;
  mainRateTax: number;
  totalTax: number;
  workings: string[];
}

export function computeCgt(args: {
  disposals: Disposal[];
  taxYear: TaxYear;
  /** Taxable income after allowances — determines how much basic rate band is left. */
  taxableIncome: number;
  basicRateLimit?: number;
  /** BADR already used in earlier years, against the £1m lifetime limit. */
  badrLifetimeUsed?: number;
}): CgtResult {
  const { disposals, taxableIncome, basicRateLimit = 37_700, badrLifetimeUsed = 0 } = args;
  const workings: string[] = [];

  if (disposals.length === 0) {
    return {
      gains: [],
      totalGains: 0,
      annualExemptAmount: 0,
      taxableGains: 0,
      badrGains: 0,
      badrTax: 0,
      mainRateTax: 0,
      totalTax: 0,
      workings: ['No disposals in the period.'],
    };
  }

  // Rates come from the latest disposal date in the year; each disposal is
  // checked so a mixed-year set is flagged rather than silently averaged.
  const sorted = [...disposals].sort((a, b) => a.disposedOn.getTime() - b.disposedOn.getTime());
  const rates = cgtRates(sorted[sorted.length - 1]!.disposedOn);
  const earliestRates = cgtRates(sorted[0]!.disposedOn);
  if (earliestRates.badrRate !== rates.badrRate) {
    workings.push(
      `⚠️ Disposals in this set straddle a rate change (BADR ${(earliestRates.badrRate * 100).toFixed(0)}% vs ` +
        `${(rates.badrRate * 100).toFixed(0)}%). Compute these separately by disposal date.`,
    );
  }

  const gains = disposals.map((d) => ({
    disposal: d,
    gain: round2(d.proceeds - d.baseCost - (d.costsOfDisposal ?? 0)),
  }));

  const totalGains = round2(gains.reduce((s, g) => s + Math.max(0, g.gain), 0));
  const aea = Math.min(totalGains, rates.annualExemptAmount);
  const taxableGains = round2(Math.max(0, totalGains - aea));

  workings.push(
    `Total gains £${totalGains.toLocaleString()} less annual exempt amount £${aea.toLocaleString()} = ` +
      `£${taxableGains.toLocaleString()} taxable.`,
  );

  // BADR gains take the AEA proportionally, then are taxed at the BADR rate up
  // to the remaining lifetime limit.
  const badrGrossGains = round2(
    gains.filter((g) => g.disposal.claimBadr).reduce((s, g) => s + Math.max(0, g.gain), 0),
  );
  const badrShare = totalGains === 0 ? 0 : badrGrossGains / totalGains;
  const badrAfterAea = round2(taxableGains * badrShare);
  const lifetimeRemaining = Math.max(0, rates.badrLifetimeLimit - badrLifetimeUsed);
  const badrQualifying = Math.min(badrAfterAea, lifetimeRemaining);
  const badrOverflow = round2(badrAfterAea - badrQualifying);

  const badrTax = round2(badrQualifying * rates.badrRate);
  if (badrQualifying > 0) {
    workings.push(
      `Business Asset Disposal Relief on £${badrQualifying.toLocaleString()} at ` +
        `${(rates.badrRate * 100).toFixed(0)}% = £${badrTax.toLocaleString()} ` +
        `(£${lifetimeRemaining.toLocaleString()} of the £${rates.badrLifetimeLimit.toLocaleString()} lifetime limit remained).`,
    );
  }
  if (badrOverflow > 0) {
    workings.push(
      `£${badrOverflow.toLocaleString()} of BADR-claimed gains exceed the lifetime limit and are taxed at main rates.`,
    );
  }

  // Non-BADR gains stack on top of taxable income. BADR gains use the basic
  // rate band first in HMRC's ordering, so account for that.
  const otherGains = round2(taxableGains - badrQualifying);
  const bandUsedByIncomeAndBadr = taxableIncome + badrQualifying;
  const basicRateRoom = Math.max(0, basicRateLimit - bandUsedByIncomeAndBadr);
  const atBasic = Math.min(otherGains, basicRateRoom);
  const atHigher = round2(otherGains - atBasic);

  const mainRateTax = round2(atBasic * rates.basicRate + atHigher * rates.higherRate);

  if (otherGains > 0) {
    workings.push(
      `Remaining gains: £${round2(atBasic).toLocaleString()} at ${(rates.basicRate * 100).toFixed(0)}% and ` +
        `£${atHigher.toLocaleString()} at ${(rates.higherRate * 100).toFixed(0)}% = £${mainRateTax.toLocaleString()}. ` +
        `Residential and non-residential rates are identical from 30 October 2024.`,
    );
  }

  return {
    gains,
    totalGains,
    annualExemptAmount: aea,
    taxableGains,
    badrGains: badrQualifying,
    badrTax,
    mainRateTax,
    totalTax: round2(badrTax + mainRateTax),
    workings,
  };
}

// ---------------------------------------------------------------------------
// BADR qualification tracking
// ---------------------------------------------------------------------------

export interface BadrHolding {
  personId: string;
  personName: string;
  companyId: string;
  companyName: string;
  ordinarySharePct: number;
  votingRightsPct: number;
  distributableProfitsPct: number;
  windingUpAssetsPct: number;
  isOfficerOrEmployee: boolean;
  /** Date from which ALL of the above have been continuously satisfied. */
  conditionsMetSince?: Date;
  companyIsTrading: boolean;
}

export interface BadrStatus {
  qualifiesNow: boolean;
  qualifiesFrom: Date | null;
  failedConditions: string[];
  daysRemaining: number | null;
  explanation: string;
}

const TWO_YEARS_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;

export function assessBadr(holding: BadrHolding, asAt: Date): BadrStatus {
  const failed: string[] = [];
  if (holding.ordinarySharePct < 5) failed.push('ordinary share capital below 5%');
  if (holding.votingRightsPct < 5) failed.push('voting rights below 5%');
  if (holding.distributableProfitsPct < 5 && holding.windingUpAssetsPct < 5) {
    failed.push('economic interest test not met (needs 5% of profits and winding-up assets, or 5% of proceeds)');
  }
  if (!holding.isOfficerOrEmployee) failed.push('not an officer or employee');
  if (!holding.companyIsTrading) failed.push('company is not a trading company');

  if (failed.length > 0) {
    return {
      qualifiesNow: false,
      qualifiesFrom: null,
      failedConditions: failed,
      daysRemaining: null,
      explanation:
        `${holding.personName} does not currently satisfy the BADR conditions for ${holding.companyName}: ` +
        `${failed.join('; ')} (TCGA 1992 s.169I(6), s.169S(3)).`,
    };
  }

  if (!holding.conditionsMetSince) {
    return {
      qualifiesNow: false,
      qualifiesFrom: null,
      failedConditions: [],
      daysRemaining: null,
      explanation:
        `All BADR conditions appear satisfied for ${holding.personName} in ${holding.companyName}, but the date ` +
        `they were first met has not been recorded. The 2-year clock cannot be assessed without it.`,
    };
  }

  const qualifiesFrom = new Date(holding.conditionsMetSince.getTime() + TWO_YEARS_MS);
  const qualifiesNow = asAt >= qualifiesFrom;
  const daysRemaining = qualifiesNow
    ? 0
    : Math.ceil((qualifiesFrom.getTime() - asAt.getTime()) / 86_400_000);

  return {
    qualifiesNow,
    qualifiesFrom,
    failedConditions: [],
    daysRemaining,
    explanation: qualifiesNow
      ? `${holding.personName} has satisfied all BADR conditions for ${holding.companyName} continuously since ` +
        `${holding.conditionsMetSince.toISOString().slice(0, 10)}, so the 2-year period was completed on ` +
        `${qualifiesFrom.toISOString().slice(0, 10)}.`
      : `${holding.personName} satisfies the BADR conditions for ${holding.companyName} but has not yet completed ` +
        `the 2-year period — ${daysRemaining} days remain, qualifying on ${qualifiesFrom.toISOString().slice(0, 10)}. ` +
        `A disposal before then gets no relief, and transferring shares now does not start a shorter clock.`,
  };
}

/** 60-day reporting deadline for a UK residential property disposal. */
export function cgt60DayDeadline(disposalDate: Date): Date {
  return new Date(disposalDate.getTime() + 60 * 86_400_000);
}
