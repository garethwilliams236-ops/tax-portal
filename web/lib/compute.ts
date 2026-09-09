/**
 * The computation screens.
 *
 * One module defines, per tax, what you type and what is made of it. The
 * screens themselves render this — they hold no arithmetic, so a rule change
 * lands in one place rather than in a form.
 *
 * Two rules hold throughout:
 *
 *   1. Nothing here is stored. Only the typed inputs are persisted; every
 *      figure below is recomputed from them and the dated rate tables on each
 *      render. A corrected rate reaches every historic screen at once.
 *
 *   2. A computed figure is an ESTIMATE. It is never a liability. It becomes
 *      one only by being filed as a return's declared amount, deliberately,
 *      which is what `fileReturn` does and what the ledger enforces.
 */

import { computeCorporationTax } from '@/lib/tax/corporation-tax';
import { computeAnnualNic } from '@/lib/tax/paye-nic';
import { computeSelfEmployedNic, type SelfEmployedNicResult } from '@/lib/tax/self-employed-nic';
import { computeIncomeTax } from '@/lib/tax/income-tax';
import { taxYearOf, nicRates, type TaxYear } from '@/lib/tax/rates';
import type { TaxType } from '@/lib/tax/obligations';
import type { Slot } from '@/lib/db/slots';
import type { EntityRow } from '@/lib/db/queries';

export type Inputs = Record<string, number>;

export interface Field {
  name: string;
  label: string;
  /** Shown under the field. Say what belongs in it, in the words of the return. */
  help?: string;
  kind?: 'money' | 'count';
  /** Start a new labelled group above this field. */
  group?: string;
}

export interface Line {
  label: string;
  value: number;
  /** The subtotal or the answer, rather than a working. */
  strong?: boolean;
  note?: string;
}

export interface Computation {
  /** The figure the return would declare, or null if it cannot be computed. */
  figure: number | null;
  figureLabel: string;
  lines: Line[];
  workings: string[];
  /** Reasons the figure is absent, partial, or needs a judgement made. */
  warnings: string[];
}

const n = (i: Inputs, k: string) => Number(i[k] ?? 0) || 0;
const r2 = (x: number) => Math.round(x * 100) / 100;
const money = (x: number) => '£' + x.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// What you type
// ---------------------------------------------------------------------------

/** Only the taxes with a screen. A tax absent here has no computation yet. */
export const FIELDS: Partial<Record<TaxType, Field[]>> = {
  CT: [
    { name: 'profitBeforeTax', label: 'Profit before tax', group: 'From the accounts',
      help: 'Per the statutory accounts, before any tax adjustment.' },
    { name: 'addBacks', label: 'Add backs',
      help: 'Depreciation, entertaining, and anything else disallowable.' },
    { name: 'deductions', label: 'Deductions',
      help: 'Capital allowances, losses brought forward, and other reliefs.' },
    { name: 'distributionsReceived', label: 'Distributions received', group: 'Adjustments',
      help: 'Non-group dividends. These raise augmented profits and so the limits tested, without raising the profit taxed.' },
    { name: 'associatedCompanies', label: 'Associated companies', kind: 'count',
      help: 'Excluding this company. Association is a judgement on control and interdependence — record it in the association workspace, not here.' },
  ],
  VAT: [
    { name: 'box1', label: 'Box 1 — VAT due on sales', group: 'VAT' },
    { name: 'box2', label: 'Box 2 — VAT due on acquisitions',
      help: 'Northern Ireland acquisitions from EU member states only.' },
    { name: 'box4', label: 'Box 4 — VAT reclaimed on purchases' },
    { name: 'box6', label: 'Box 6 — Total sales excluding VAT', group: 'Values' },
    { name: 'box7', label: 'Box 7 — Total purchases excluding VAT' },
    { name: 'box8', label: 'Box 8 — Goods supplied to the EU' },
    { name: 'box9', label: 'Box 9 — Goods acquired from the EU' },
  ],
  PAYE: [
    { name: 'grossPay', label: 'Gross pay', group: 'The month',
      help: 'Total pay for the tax month, before deductions.' },
    { name: 'incomeTax', label: 'PAYE income tax deducted' },
    { name: 'employeeNic', label: 'Employee NIC' },
    { name: 'employerNic', label: 'Employer NIC' },
    { name: 'studentLoan', label: 'Student loan deducted' },
    { name: 'employmentAllowanceUsed', label: 'Employment Allowance claimed', group: 'Reductions',
      help: 'Reported on the EPS, not the FPS. One allowance across connected companies.' },
    { name: 'statutoryRecoveries', label: 'Statutory payment recoveries',
      help: 'SMP, SPP and the like reclaimed, plus compensation.' },
    { name: 'directorAnnualPay', label: 'Director annual pay — check', group: 'Annual check',
      help: 'Optional. Enter a director’s pay for the whole tax year and the NIC due on it on the annual basis is shown below. It does not affect the amount payable.' },
  ],
  SA: [
    { name: 'employment', label: 'Employment income', group: 'Income' },
    { name: 'selfEmployment', label: 'Self-employment profit' },
    { name: 'property', label: 'Property profit',
      help: 'After allowable expenses but BEFORE residential finance costs.' },
    { name: 'propertyFinanceCosts', label: 'Residential finance costs',
      help: 'Relieved as a basic rate reducer under s.24, not deducted from profit.' },
    { name: 'pension', label: 'Pension income' },
    { name: 'savings', label: 'Savings interest' },
    { name: 'dividends', label: 'Dividends' },
    { name: 'grossPensionContributions', label: 'Gross pension contributions', group: 'Reliefs',
      help: 'Grossed up. Reduces adjusted net income, so it can recover personal allowance.' },
    { name: 'giftAidGross', label: 'Gift Aid — gross' },
    { name: 'taxDeductedAtSource', label: 'Tax already deducted', group: 'Tax paid',
      help: 'PAYE and other tax deducted at source. Reduces the balance owed, not the liability.' },
  ],
};

// ---------------------------------------------------------------------------
// What is made of it
// ---------------------------------------------------------------------------

/**
 * Figures the portal already holds in detail for this period, which stand in
 * for the typed totals. Property is the first: once a property's figures are
 * recorded for a tax year, retyping the total is a second chance to be wrong.
 */
export interface Detail {
  propertyProfit?: number;
  propertyFinanceCosts?: number;
  /** How many properties the figures came from, for the note on the screen. */
  propertyCount?: number;
}

export function compute(
  taxType: TaxType,
  inputs: Inputs,
  slot: Slot,
  entity: EntityRow,
  detail: Detail = {},
): Computation {
  switch (taxType) {
    case 'CT': return ct(inputs, slot, entity);
    case 'VAT': return vat(inputs);
    case 'PAYE': return paye(inputs, slot);
    case 'SA': return sa(inputs, slot, detail);
    default:
      return { figure: null, figureLabel: '', lines: [], workings: [], warnings: ['No computation screen for this tax yet.'] };
  }
}

function ct(i: Inputs, slot: Slot, entity: EntityRow): Computation {
  const warnings: string[] = [];
  const ttp = r2(n(i, 'profitBeforeTax') + n(i, 'addBacks') - n(i, 'deductions'));

  const start = slot.periodStart ?? new Date(Date.UTC(
    slot.periodEnd.getUTCFullYear() - 1, slot.periodEnd.getUTCMonth(), slot.periodEnd.getUTCDate() + 1));

  let res;
  try {
    res = computeCorporationTax({
      periodStart: start,
      periodEnd: slot.periodEnd,
      taxableTotalProfits: ttp,
      distributionsReceived: n(i, 'distributionsReceived'),
      associationDivisor: 1 + Math.max(0, Math.round(n(i, 'associatedCompanies'))),
      isCloseInvestmentHoldingCompany: entity.is_close_investment_holding_company,
    });
  } catch (e) {
    return { figure: null, figureLabel: 'Corporation Tax', lines: [], workings: [], warnings: [String((e as Error).message)] };
  }

  if (entity.is_close_investment_holding_company) {
    warnings.push('Treated as a close investment holding company: the small profits rate and marginal relief are denied entirely (CTA 2010 s.34).');
  }
  if (res.qipApplies) {
    warnings.push('Augmented profits exceed the instalment threshold. Quarterly instalments are due from 6 months and 13 days after the period STARTED — before this return exists.');
  }
  if (n(i, 'associatedCompanies') > 0) {
    warnings.push('The limits are divided by the number of associated companies. Association is a judgement on control and substantial commercial interdependence, and the portal applies what you have recorded rather than deciding it.');
  }

  return {
    figure: res.taxDue,
    figureLabel: 'Corporation Tax',
    warnings,
    workings: res.workings,
    lines: [
      { label: 'Profit before tax', value: n(i, 'profitBeforeTax') },
      { label: 'Add backs', value: n(i, 'addBacks') },
      { label: 'Deductions', value: -n(i, 'deductions') },
      { label: 'Taxable total profits (N)', value: res.taxableTotalProfits, strong: true },
      { label: 'Augmented profits (A)', value: res.augmentedProfits,
        note: 'The limits are tested against A; relief is applied to N.' },
      { label: 'Lower limit', value: res.lowerLimit },
      { label: 'Upper limit', value: res.upperLimit },
      { label: `Tax at ${res.rateApplied === 'small_profits' ? 'the small profits rate' : 'the main rate'}`, value: res.taxAtMainRate },
      { label: 'Marginal relief', value: -res.marginalRelief },
      { label: 'Corporation Tax due', value: res.taxDue, strong: true,
        note: `Effective rate ${(res.effectiveRate * 100).toFixed(2)}% over ${res.daysInPeriod} days.` },
    ],
  };
}

function vat(i: Inputs): Computation {
  const box1 = n(i, 'box1'), box2 = n(i, 'box2'), box4 = n(i, 'box4');
  const box3 = r2(box1 + box2);
  const box5 = r2(box3 - box4);
  const warnings: string[] = [];
  if (box5 < 0) warnings.push('Box 5 is negative: this is a repayment claim, not a payment. Record the refund as a payment received from HMRC when it arrives.');

  return {
    figure: box5,
    figureLabel: box5 < 0 ? 'VAT repayable' : 'VAT payable',
    warnings,
    workings: [
      'Box 3 = Box 1 + Box 2 (VAT due).',
      'Box 5 = Box 3 − Box 4 (the net position).',
      'Boxes 6 to 9 are values, not tax, and do not enter the calculation.',
    ],
    lines: [
      { label: 'Box 1 — VAT due on sales', value: box1 },
      { label: 'Box 2 — VAT due on acquisitions', value: box2 },
      { label: 'Box 3 — Total VAT due', value: box3, strong: true },
      { label: 'Box 4 — VAT reclaimed', value: box4 },
      { label: 'Box 5 — Net VAT', value: box5, strong: true },
      { label: 'Box 6 — Sales excluding VAT', value: n(i, 'box6') },
      { label: 'Box 7 — Purchases excluding VAT', value: n(i, 'box7') },
      { label: 'Box 8 — Goods to the EU', value: n(i, 'box8') },
      { label: 'Box 9 — Goods from the EU', value: n(i, 'box9') },
    ],
  };
}

function paye(i: Inputs, slot: Slot): Computation {
  const warnings: string[] = [];
  const tax = n(i, 'incomeTax'), ee = n(i, 'employeeNic'), er = n(i, 'employerNic');
  const sl = n(i, 'studentLoan');
  const ea = n(i, 'employmentAllowanceUsed'), rec = n(i, 'statutoryRecoveries');
  const due = r2(tax + ee + er + sl - ea - rec);

  const lines: Line[] = [
    { label: 'Gross pay for the month', value: n(i, 'grossPay'), note: 'Reported, not charged.' },
    { label: 'PAYE income tax', value: tax },
    { label: 'Employee NIC', value: ee },
    { label: 'Employer NIC', value: er },
    { label: 'Student loan', value: sl },
    { label: 'Employment Allowance claimed', value: -ea },
    { label: 'Statutory recoveries', value: -rec },
    { label: 'Payable to HMRC', value: due, strong: true },
  ];

  const workings = [
    'Income tax, both classes of NIC and student loan are added; Employment Allowance and statutory recoveries are deducted.',
    'Due by the 22nd of the following month electronically, or the 19th by post. The FPS is due on or before payday; the EPS, which carries the allowance and the recoveries, by the 19th.',
  ];

  // The annual-basis check for directors. Separate from the amount payable,
  // because a director's NIC is computed on the year, not the month, and that
  // is precisely where a monthly payroll and the year-end disagree.
  const annual = n(i, 'directorAnnualPay');
  if (annual > 0) {
    const ty = taxYearOf(slot.periodEnd);
    try {
      const nic = computeAnnualNic(annual, ty);
      const rates = nicRates(ty);
      lines.push(
        { label: `Director on £${annual.toLocaleString('en-GB')} for ${ty} — employee NIC`, value: nic.employeeNic },
        { label: 'Director — employer NIC', value: nic.employerNic },
      );
      workings.push(...nic.workings);
      if (annual >= rates.lowerEarningsLimit && annual < rates.primaryThreshold) {
        workings.push(`Between the LEL (£${rates.lowerEarningsLimit.toLocaleString('en-GB')}) and the PT (£${rates.primaryThreshold.toLocaleString('en-GB')}) the employee pays nothing but still earns a qualifying year toward State Pension.`);
      }
      if (annual > rates.secondaryThreshold) {
        workings.push(`The employer pays from the ST (£${rates.secondaryThreshold.toLocaleString('en-GB')}), which is well below the PT — hence a band on which the employer pays and the employee does not.`);
      }
    } catch (e) {
      warnings.push(`Annual check unavailable: ${(e as Error).message}`);
    }
  }

  return { figure: due, figureLabel: 'PAYE and NIC payable', lines, workings, warnings };
}

function sa(i: Inputs, slot: Slot, detail: Detail): Computation {
  const ty = slot.periodKey as TaxYear;

  // Recorded property figures win over the typed total. Where both exist the
  // typed one is ignored rather than added, and the screen says so.
  const fromProperties = detail.propertyProfit !== undefined;
  const property = fromProperties ? detail.propertyProfit! : n(i, 'property');
  const propertyFinanceCosts = fromProperties
    ? (detail.propertyFinanceCosts ?? 0)
    : n(i, 'propertyFinanceCosts');

  let res;
  try {
    res = computeIncomeTax({
      employment: n(i, 'employment'),
      selfEmployment: n(i, 'selfEmployment'),
      property,
      propertyFinanceCosts,
      pension: n(i, 'pension'),
      savings: n(i, 'savings'),
      dividends: n(i, 'dividends'),
      grossPensionContributions: n(i, 'grossPensionContributions'),
      giftAidGross: n(i, 'giftAidGross'),
    }, ty);
  } catch (e) {
    return { figure: null, figureLabel: 'Self Assessment', lines: [], workings: [], warnings: [String((e as Error).message)] };
  }

  const deducted = n(i, 'taxDeductedAtSource');
  const warnings: string[] = [];

  if (fromProperties) {
    const count = detail.propertyCount ?? 0;
    warnings.push(`Property income of ${money(property)} comes from the ${count === 1 ? 'property' : `${count} properties`} recorded for ${ty}, apportioned by the share taxed on this person. Anything typed into the property boxes on the left is ignored while those figures exist.`);
  }
  if (res.personalAllowanceLost > 0) {
    warnings.push(`£${res.personalAllowanceLost.toLocaleString('en-GB')} of personal allowance is lost to the taper. A further gross pension contribution reduces adjusted net income and recovers allowance at the marginal rate.`);
  }
  // Class 2 and Class 4 on the typed trading profit, so this screen and the
  // box-by-box return do not disagree about the same year.
  let nic: SelfEmployedNicResult | null = null;
  if (n(i, 'selfEmployment') > 0) {
    try {
      nic = computeSelfEmployedNic({ profits: n(i, 'selfEmployment') }, ty);
      warnings.push(...nic.notes);
    } catch (e) {
      warnings.push(`${(e as Error).message} — Class 2 and Class 4 are not in this figure.`);
    }
  }
  const totalDue = r2(res.totalTax + (nic?.total ?? 0));
  const balance = r2(totalDue - deducted);
  if (balance >= 1000) {
    warnings.push('A balance of £1,000 or more sets payments on account for the following year at half this liability each, due 31 January and 31 July — unless 80% or more of the tax was deducted at source. Class 4 counts towards them; Class 2 does not.');
  }

  return {
    figure: totalDue,
    figureLabel: nic ? 'Income tax and NIC' : 'Income tax liability',
    warnings,
    workings: [...res.workings, ...(nic?.workings ?? [])],
    lines: [
      { label: 'Total income', value: res.totalIncome },
      { label: 'Adjusted net income', value: res.adjustedNetIncome,
        note: 'The measure the allowance taper and the child benefit charge are tested against.' },
      { label: 'Personal allowance', value: res.personalAllowance },
      { label: 'Allowance lost to taper', value: -res.personalAllowanceLost },
      { label: 'Tax on non-savings income', value: res.taxByCategory.nonSavings },
      { label: 'Tax on property income', value: res.taxByCategory.property },
      { label: 'Tax on savings income', value: res.taxByCategory.savings },
      { label: 'Tax on dividends', value: res.taxByCategory.dividends },
      { label: 'Finance cost reducer', value: -res.financeCostReducer },
      { label: 'Income tax liability', value: res.totalTax, strong: true,
        note: `Marginal rate ${(res.marginalRate * 100).toFixed(2)}%.` },
      ...(nic ? [
        { label: 'Class 4 NIC', value: nic.class4 },
        { label: 'Class 2 NIC, voluntary', value: nic.class2,
          note: nic.class2Credited
            ? 'Profits reach the Small Profits Threshold, so Class 2 is credited without being paid.'
            : 'Below the Small Profits Threshold. Nothing is due; the year is not credited unless it is bought.' },
        { label: 'Total due', value: totalDue, strong: true },
      ] : []),
      { label: 'Tax deducted at source', value: -deducted },
      { label: 'Balance', value: balance, strong: true },
    ],
  };
}
