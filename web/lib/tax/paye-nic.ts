/**
 * PAYE, NIC and the Employment Allowance.
 *
 * The Employment Allowance test is the one worth getting exactly right.
 *
 * The statute (NICA 2014 s.2(4A)) excludes a company where all payments of
 * earnings go to a single employed earner who is a director. HMRC's operating
 * test (NIM06545) counts HEADS PAID ABOVE THE SECONDARY THRESHOLD, not
 * directorships: "the decisive factor is that the additional employees must be
 * paid above the Secondary Threshold."
 *
 * So five directors with four unpaid and one on £60,000 is NOT eligible, and a
 * sole director on £3,000 with one employee on £20,000 IS eligible.
 *
 * Directors have an ANNUAL earnings period, so the annual secondary threshold
 * governs (pro-rated if the directorship began mid-year), not a weekly figure.
 *
 * Connected companies (NICA 2014 s.3) get ONE allowance between them, tested at
 * the beginning of the tax year. See `chooseEmploymentAllowanceClaimant`.
 */

import { nicRates, type TaxYear } from './rates';

export interface PayrollPerson {
  personId: string;
  name: string;
  isDirector: boolean;
  /** Total earnings for the tax year subject to Class 1 secondary NIC. */
  annualEarnings: number;
  /** Set where a directorship began mid-year; the ST is pro-rated. */
  directorshipStartedOn?: Date;
}

export interface EmploymentAllowanceAssessment {
  eligible: boolean;
  headsAboveSecondaryThreshold: number;
  secondaryThreshold: number;
  allowance: number;
  reason: string;
  /** Non-fatal warnings — chiefly the contested sub-threshold second director. */
  warnings: string[];
}

function proratedSecondaryThreshold(
  annualThreshold: number,
  taxYear: TaxYear,
  startedOn?: Date,
): number {
  if (!startedOn) return annualThreshold;
  const [startYearStr] = taxYear.split('-');
  const startYear = Number(startYearStr);
  const yearStart = Date.UTC(startYear, 3, 6);
  const yearEnd = Date.UTC(startYear + 1, 3, 5);
  if (startedOn.getTime() <= yearStart) return annualThreshold;
  const totalDays = Math.round((yearEnd - yearStart) / 86_400_000) + 1;
  const remainingDays = Math.round((yearEnd - startedOn.getTime()) / 86_400_000) + 1;
  return Math.round((annualThreshold * remainingDays) / totalDays);
}

export function assessEmploymentAllowance(
  people: PayrollPerson[],
  taxYear: TaxYear,
): EmploymentAllowanceAssessment {
  const rates = nicRates(taxYear);
  const warnings: string[] = [];

  const aboveThreshold = people.filter(
    (p) =>
      p.annualEarnings >
      proratedSecondaryThreshold(rates.secondaryThreshold, taxYear, p.directorshipStartedOn),
  );

  const heads = aboveThreshold.length;

  // The contested case: a second director paid something but below the ST.
  const paidButBelow = people.filter(
    (p) =>
      p.annualEarnings > 0 &&
      p.annualEarnings <=
        proratedSecondaryThreshold(rates.secondaryThreshold, taxYear, p.directorshipStartedOn),
  );
  if (heads === 1 && paidButBelow.length > 0) {
    warnings.push(
      'A second person is paid but below the secondary threshold. HMRC (NIM06545) treat this as ' +
        'ineligible; a literal reading of s.2(4A) is arguably against them, since payments are then ' +
        'not all to the same earner. Not worth arguing over £' +
        rates.employmentAllowance.toLocaleString() +
        ' — pay them above £' +
        rates.secondaryThreshold.toLocaleString() +
        ' and the question disappears.',
    );
  }

  if (heads === 0) {
    return {
      eligible: false,
      headsAboveSecondaryThreshold: 0,
      secondaryThreshold: rates.secondaryThreshold,
      allowance: 0,
      reason: 'No secondary Class 1 liability — nobody is paid above the secondary threshold.',
      warnings,
    };
  }

  if (heads === 1) {
    const only = aboveThreshold[0]!;
    if (only.isDirector) {
      return {
        eligible: false,
        headsAboveSecondaryThreshold: 1,
        secondaryThreshold: rates.secondaryThreshold,
        allowance: 0,
        reason:
          `Excluded: the only person paid above the secondary threshold (${only.name}) is a director ` +
          '(NICA 2014 s.2(4A), NIM06545). Pay a second person above the threshold to qualify.',
        warnings,
      };
    }
    return {
      eligible: true,
      headsAboveSecondaryThreshold: 1,
      secondaryThreshold: rates.secondaryThreshold,
      allowance: rates.employmentAllowance,
      reason:
        `Eligible: the only person paid above the secondary threshold (${only.name}) is not a director, ` +
        'so the s.2(4A) exclusion does not apply.',
      warnings,
    };
  }

  return {
    eligible: true,
    headsAboveSecondaryThreshold: heads,
    secondaryThreshold: rates.secondaryThreshold,
    allowance: rates.employmentAllowance,
    reason: `Eligible: ${heads} people are paid above the annual secondary threshold of £${rates.secondaryThreshold.toLocaleString()}.`,
    warnings,
  };
}

/**
 * Connected companies get ONE Employment Allowance between them (NICA 2014
 * s.3). Connection is tested at the beginning of the tax year. There is no
 * election to file — the companies simply decide. Unused allowance is not
 * transferable mid-year, so claim it where it will actually be absorbed.
 */
export interface ClaimantCandidate {
  entityId: string;
  name: string;
  eligible: boolean;
  /** Expected secondary Class 1 liability for the year. */
  expectedEmployerNic: number;
}

export function chooseEmploymentAllowanceClaimant(
  candidates: ClaimantCandidate[],
  taxYear: TaxYear,
): { claimantId: string | null; reason: string } {
  const rates = nicRates(taxYear);
  const eligible = candidates.filter((c) => c.eligible);

  if (eligible.length === 0) {
    return { claimantId: null, reason: 'No connected company qualifies for the allowance.' };
  }
  if (eligible.length === 1) {
    return {
      claimantId: eligible[0]!.entityId,
      reason: `${eligible[0]!.name} is the only qualifying company, so s.3 does not bite.`,
    };
  }

  const best = [...eligible].sort((a, b) => b.expectedEmployerNic - a.expectedEmployerNic)[0]!;
  return {
    claimantId: best.entityId,
    reason:
      `${eligible.length} connected companies qualify, but only one allowance is available (NICA 2014 s.3). ` +
      `Claim in ${best.name}, which has the largest expected secondary Class 1 liability ` +
      `(£${best.expectedEmployerNic.toLocaleString()}) and will absorb the most of the ` +
      `£${rates.employmentAllowance.toLocaleString()}. Unused allowance is not transferable mid-year.`,
  };
}

// ---------------------------------------------------------------------------
// Employer and employee NIC on annual earnings (directors' annual basis)
// ---------------------------------------------------------------------------

export interface NicResult {
  employeeNic: number;
  employerNic: number;
  workings: string[];
}

export function computeAnnualNic(annualEarnings: number, taxYear: TaxYear): NicResult {
  const r = nicRates(taxYear);
  const workings: string[] = [];

  const mainBand = Math.max(
    0,
    Math.min(annualEarnings, r.upperEarningsLimit) - r.primaryThreshold,
  );
  const upperBand = Math.max(0, annualEarnings - r.upperEarningsLimit);
  const employeeNic =
    Math.round((mainBand * r.employeeMainRate + upperBand * r.employeeUpperRate) * 100) / 100;

  const secondaryBand = Math.max(0, annualEarnings - r.secondaryThreshold);
  const employerNic = Math.round(secondaryBand * r.employerRate * 100) / 100;

  workings.push(
    `Employee: ${(r.employeeMainRate * 100).toFixed(0)}% on £${mainBand.toLocaleString()} ` +
      `(PT £${r.primaryThreshold.toLocaleString()} to UEL £${r.upperEarningsLimit.toLocaleString()})` +
      (upperBand > 0
        ? ` plus ${(r.employeeUpperRate * 100).toFixed(0)}% on £${upperBand.toLocaleString()} above the UEL`
        : '') +
      ` = £${employeeNic.toLocaleString()}.`,
  );
  workings.push(
    `Employer: ${(r.employerRate * 100).toFixed(0)}% on £${secondaryBand.toLocaleString()} above the ` +
      `secondary threshold of £${r.secondaryThreshold.toLocaleString()} = £${employerNic.toLocaleString()}.`,
  );

  return { employeeNic, employerNic, workings };
}

/** PAYE payment due: 22nd of the following tax month for electronic payment. */
export function payePaymentDueDate(taxMonthEnd: Date): Date {
  const d = new Date(taxMonthEnd.getTime());
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(22);
  return d;
}
