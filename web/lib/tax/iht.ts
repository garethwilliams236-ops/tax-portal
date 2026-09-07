/**
 * Inheritance tax — gift cumulation, taper relief, and the nil-rate bands.
 *
 * TAPER RELIEF IS THE TRAP. It reduces the TAX PAYABLE ON THE GIFT, not the
 * value of the gift (IHTM14611: "Taper relief does not reduce the capital value
 * of the transfer"), and it only bites where the gift bears tax IN ITS OWN
 * RIGHT — that is, where it exceeds the nil-rate band available after
 * cumulating earlier chargeable transfers.
 *
 * So a £300,000 gift five years before death gets NO taper benefit at all: it
 * sits inside the NRB, no tax arises on it to taper, and it simply absorbs NRB
 * and increases the tax on the death estate. A naive implementation that
 * applies the taper percentage to the gift value is wrong in the common case.
 * See the tests.
 *
 * RNRB tapers £1 for every £2 by which the estate exceeds £2m — and business
 * assets count toward that £2m at their UNRELIEVED value, so a business-owning
 * estate can lose the whole RNRB while the business itself is fully relieved.
 */

import { ihtRates, TAPER_RELIEF_BANDS } from './rates';

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type GiftClassification =
  | 'PET'
  | 'CLT'
  | 'exempt_annual'
  | 'exempt_small'
  | 'exempt_wedding'
  | 'exempt_normal_expenditure'
  | 'exempt_spouse'
  | 'exempt_charity';

export interface Gift {
  id: string;
  date: Date;
  value: number;
  classification: GiftClassification;
  beneficiary?: string;
  reservationOfBenefit?: boolean;
}

export function isChargeable(g: Gift): boolean {
  return (g.classification === 'PET' || g.classification === 'CLT') && !g.reservationOfBenefit;
}

export function taperReduction(yearsBetween: number): number {
  if (yearsBetween >= 7) return 1;
  const band = TAPER_RELIEF_BANDS.find(
    (b) => yearsBetween >= b.yearsFrom && yearsBetween < b.yearsTo,
  );
  return band ? band.reduction : 0;
}

export interface FailedPetResult {
  gift: Gift;
  yearsBeforeDeath: number;
  /** NRB still available when this gift was made, after earlier cumulation. */
  nilRateBandAvailable: number;
  /** Portion of the gift falling within the NRB — bears no tax, so no taper. */
  coveredByNrb: number;
  /** Portion above the NRB — this is what bears tax and can be tapered. */
  chargeableAboveNrb: number;
  taxBeforeTaper: number;
  taperReductionRate: number;
  taperRelief: number;
  taxPayable: number;
  explanation: string;
}

export interface EstateComputationInput {
  dateOfDeath: Date;
  /** Gross estate at death, before reliefs and exemptions. */
  estateValue: number;
  /**
   * Value of business/agricultural assets in the estate at UNRELIEVED value.
   * Counts toward the £2m RNRB taper threshold even where fully relieved.
   */
  businessAssetsUnrelievedValue?: number;
  /** Relief actually given on those assets (computed elsewhere, or supplied). */
  businessReliefGiven?: number;
  /** Passing to spouse — wholly exempt, IHTA 1984 s.18. */
  spouseExemptAmount?: number;
  charityAmount?: number;
  /** Does a qualifying residence pass to lineal descendants? */
  residenceToDirectDescendants: boolean;
  residenceValue?: number;
  /** Percentage of a predeceased spouse's unused NRB, 0–1. */
  transferredNrbPercentage?: number;
  transferredRnrbPercentage?: number;
  gifts: Gift[];
}

export interface EstateComputationResult {
  failedPets: FailedPetResult[];
  cumulativeChargeableTransfers: number;
  nilRateBand: number;
  transferredNrb: number;
  nilRateBandAvailableToEstate: number;
  residenceNilRateBand: number;
  rnrbTapered: number;
  rnrbAvailable: number;
  chargeableEstate: number;
  estateTax: number;
  giftsTax: number;
  totalTax: number;
  rateApplied: number;
  workings: string[];
}

/**
 * Compute the IHT position on death, including tax on failed PETs.
 *
 * Method:
 *  1. Take chargeable gifts in the 7 years before death, oldest first.
 *  2. For each, the available NRB is the full NRB less chargeable transfers in
 *     the 7 years BEFORE THAT GIFT (the rolling cumulation).
 *  3. Tax arises only on the excess over that available NRB. Taper applies to
 *     that tax only.
 *  4. The estate's NRB is reduced by the cumulative total of chargeable
 *     transfers in the 7 years before death.
 */
export function computeEstate(input: EstateComputationInput): EstateComputationResult {
  const r = ihtRates(input.dateOfDeath);
  const workings: string[] = [];

  const chargeableGifts = input.gifts
    .filter(isChargeable)
    .filter((g) => g.date <= input.dateOfDeath)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const sevenYearsBeforeDeath = new Date(input.dateOfDeath.getTime() - 7 * YEAR_MS);
  const giftsInScope = chargeableGifts.filter((g) => g.date > sevenYearsBeforeDeath);

  const failedPets: FailedPetResult[] = [];
  let giftsTax = 0;

  for (const gift of giftsInScope) {
    // Cumulation: chargeable transfers in the 7 years before THIS gift.
    const sevenYearsBeforeGift = new Date(gift.date.getTime() - 7 * YEAR_MS);
    const priorCumulative = chargeableGifts
      .filter((g) => g.date < gift.date && g.date > sevenYearsBeforeGift)
      .reduce((sum, g) => sum + g.value, 0);

    const nrbAvailable = Math.max(0, r.nilRateBand - priorCumulative);
    const coveredByNrb = Math.min(gift.value, nrbAvailable);
    const above = Math.max(0, gift.value - nrbAvailable);

    const years = (input.dateOfDeath.getTime() - gift.date.getTime()) / YEAR_MS;
    const reduction = taperReduction(years);

    const taxBeforeTaper = round2(above * r.deathRate);
    const relief = round2(taxBeforeTaper * reduction);
    const payable = round2(taxBeforeTaper - relief);

    giftsTax += payable;

    const explanation =
      above === 0
        ? `Gift of £${gift.value.toLocaleString()} made ${years.toFixed(1)} years before death falls entirely within ` +
          `the £${nrbAvailable.toLocaleString()} of nil-rate band available at that date. No tax arises on the gift ` +
          `itself, so TAPER RELIEF GIVES NOTHING — taper reduces tax on the gift, not its value (IHTM14611). ` +
          `The gift still absorbs nil-rate band and so increases the tax on the death estate.`
        : `Gift of £${gift.value.toLocaleString()} made ${years.toFixed(1)} years before death. ` +
          `£${coveredByNrb.toLocaleString()} is covered by the nil-rate band available at that date ` +
          `(£${r.nilRateBand.toLocaleString()} less £${priorCumulative.toLocaleString()} cumulated). ` +
          `£${above.toLocaleString()} bears tax at 40% = £${taxBeforeTaper.toLocaleString()}, reduced by ` +
          `${(reduction * 100).toFixed(0)}% taper relief (£${relief.toLocaleString()}) to £${payable.toLocaleString()}.`;

    failedPets.push({
      gift,
      yearsBeforeDeath: Math.round(years * 100) / 100,
      nilRateBandAvailable: nrbAvailable,
      coveredByNrb,
      chargeableAboveNrb: above,
      taxBeforeTaper,
      taperReductionRate: reduction,
      taperRelief: relief,
      taxPayable: payable,
      explanation,
    });
    workings.push(explanation);
  }

  // The estate's NRB is reduced by cumulative chargeable transfers in the 7
  // years before death.
  const cumulative = giftsInScope.reduce((s, g) => s + g.value, 0);
  const transferredNrb = round2(r.nilRateBand * (input.transferredNrbPercentage ?? 0));
  const nrbToEstate = Math.max(0, r.nilRateBand + transferredNrb - cumulative);

  workings.push(
    `Nil-rate band available to the estate: £${r.nilRateBand.toLocaleString()}` +
      (transferredNrb > 0 ? ` plus £${transferredNrb.toLocaleString()} transferred` : '') +
      ` less £${cumulative.toLocaleString()} of chargeable transfers in the 7 years before death = ` +
      `£${nrbToEstate.toLocaleString()}.`,
  );

  // RNRB and its taper. Business assets count toward the £2m at UNRELIEVED value.
  const baseRnrb = input.residenceToDirectDescendants
    ? Math.min(r.residenceNilRateBand, input.residenceValue ?? r.residenceNilRateBand)
    : 0;
  const transferredRnrb = input.residenceToDirectDescendants
    ? round2(r.residenceNilRateBand * (input.transferredRnrbPercentage ?? 0))
    : 0;

  const estateForTaper = input.estateValue; // unrelieved values
  const taperExcess = Math.max(0, estateForTaper - r.rnrbTaperThreshold);
  const rnrbTapered = Math.min(baseRnrb + transferredRnrb, taperExcess / r.rnrbTaperDivisor);
  const rnrbAvailable = round2(Math.max(0, baseRnrb + transferredRnrb - rnrbTapered));

  if (input.residenceToDirectDescendants) {
    if (taperExcess > 0) {
      workings.push(
        `RNRB taper: estate of £${estateForTaper.toLocaleString()} (business assets counted at UNRELIEVED value) ` +
          `exceeds £${r.rnrbTaperThreshold.toLocaleString()} by £${taperExcess.toLocaleString()}, reducing the RNRB by ` +
          `£${round2(rnrbTapered).toLocaleString()} (£1 per £2) to £${rnrbAvailable.toLocaleString()}.`,
      );
    } else {
      workings.push(
        `RNRB of £${rnrbAvailable.toLocaleString()} available in full — the estate does not exceed the ` +
          `£${r.rnrbTaperThreshold.toLocaleString()} taper threshold.`,
      );
    }
  } else {
    workings.push('No RNRB: no qualifying residence passing to lineal descendants.');
  }

  const exemptions = (input.spouseExemptAmount ?? 0) + (input.charityAmount ?? 0);
  const reliefs = input.businessReliefGiven ?? 0;
  const netEstate = Math.max(0, input.estateValue - exemptions - reliefs);
  const chargeableEstate = Math.max(0, netEstate - nrbToEstate - rnrbAvailable);

  // Reduced 36% rate where 10%+ of the baseline amount passes to charity.
  const baselineAmount = Math.max(0, netEstate - nrbToEstate);
  const charityQualifies =
    (input.charityAmount ?? 0) > 0 &&
    baselineAmount > 0 &&
    (input.charityAmount ?? 0) >= baselineAmount * r.charityReducedRateThreshold;
  const rateApplied = charityQualifies ? r.charityReducedRate : r.deathRate;

  if (charityQualifies) {
    workings.push(
      `Reduced rate of ${(r.charityReducedRate * 100).toFixed(0)}% applies — charitable legacy of ` +
        `£${(input.charityAmount ?? 0).toLocaleString()} is at least 10% of the baseline amount of ` +
        `£${round2(baselineAmount).toLocaleString()}.`,
    );
  }

  const estateTax = round2(chargeableEstate * rateApplied);

  workings.push(
    `Chargeable estate £${round2(chargeableEstate).toLocaleString()} at ${(rateApplied * 100).toFixed(0)}% = ` +
      `£${estateTax.toLocaleString()}.`,
  );

  return {
    failedPets,
    cumulativeChargeableTransfers: round2(cumulative),
    nilRateBand: r.nilRateBand,
    transferredNrb,
    nilRateBandAvailableToEstate: round2(nrbToEstate),
    residenceNilRateBand: r.residenceNilRateBand,
    rnrbTapered: round2(rnrbTapered),
    rnrbAvailable,
    chargeableEstate: round2(chargeableEstate),
    estateTax,
    giftsTax: round2(giftsTax),
    totalTax: round2(estateTax + giftsTax),
    rateApplied,
    workings,
  };
}

/** IHT due date: end of the sixth month after the month of death. */
export function ihtPaymentDueDate(dateOfDeath: Date): Date {
  const d = new Date(Date.UTC(dateOfDeath.getUTCFullYear(), dateOfDeath.getUTCMonth() + 7, 0));
  return d;
}

/** IHT400 delivery deadline: 12 months from the end of the month of death. */
export function iht400DueDate(dateOfDeath: Date): Date {
  return new Date(Date.UTC(dateOfDeath.getUTCFullYear() + 1, dateOfDeath.getUTCMonth() + 1, 0));
}
