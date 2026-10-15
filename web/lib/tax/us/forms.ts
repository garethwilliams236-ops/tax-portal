import { CTC_PHASEOUT, FBAR_THRESHOLD, NIIT_THRESHOLD, usRates } from './rates';
import type { UsInputs, UsResult } from './form1040';

/**
 * The US return laid out as the IRS forms are, line by line.
 *
 * Line numbers and captions are taken from the 2025 forms as published on
 * irs.gov (checked 15 October 2026): Form 1040, Schedules 1, 2, 3, B and
 * 8812, and Forms 2555, 1116 and 8960. Captions are shortened where the
 * printed one runs to a paragraph, but say the same thing.
 *
 * Every figure here is read from the computation, never computed again, so
 * the forms and the summary cannot disagree. Only the lines this portal has
 * figures for are shown; a line that does not apply to her (household
 * employee wages, clean-vehicle credits) is left out rather than shown as nil.
 *
 * The 2026 forms are not yet published. The 2026 year is laid out on the 2025
 * forms and says so.
 */

export const FORMS_YEAR = 2025;

export interface FormLine {
  no: string;
  caption: string;
  /** Whole dollars, as the IRS allows. Null where the line is a yes/no or text. */
  amount?: number | null;
  text?: string;
  /** One sentence for someone who is not an accountant. */
  plain?: string;
  /** A total or result line. */
  total?: boolean;
}

export interface UsForm {
  code: string;
  title: string;
  /** What the form is for, in a sentence. */
  plain: string;
  lines: FormLine[];
  note?: string;
}

const $ = (n: number) => Math.round(n);

export function buildForms(i: UsInputs, r: UsResult): UsForm[] {
  const p = r.parts;
  const rates = usRates(i.year);
  const forms: UsForm[] = [];

  const sched1Line8d = -r.exclusion;
  const sched1Line9 = sched1Line8d + i.otherIncome;
  const sched1Line10 = i.rental + sched1Line9;
  const line1z = i.usWages + i.foreignEarned;
  const sched3Line8 = r.ftc;
  const line21 = r.childCredit + sched3Line8;
  const line22 = Math.max(0, r.incomeTax - line21);
  const paid = i.usWithholding + i.estimatedPayments;
  const line33 = paid + r.childCreditRefund;
  const need = {
    s1: r.exclusion > 0 || i.rental !== 0 || i.otherIncome !== 0 || i.adjustments !== 0,
    s2: r.niit > 0,
    s3: r.ftc > 0,
    sB: i.interest > 1_500 || i.ordinaryDividends > 1_500 || i.foreignAccountsMax > 0,
    s8812: p.kids > 0,
    f2555: r.exclusion > 0,
    f1116: r.baskets.some((b) => b.ukTax > 0),
    f8960: r.niit > 0,
  };

  // --- Form 1040 -----------------------------------------------------------
  forms.push({
    code: '1040',
    title: 'Form 1040 — U.S. Individual Income Tax Return',
    plain: 'The main return. Everything else feeds into it.',
    lines: [
      ...(i.usWages ? [{ no: '1a', caption: 'Total amount from Form(s) W-2, box 1', amount: $(i.usWages), plain: 'Pay from a US employer.' }] : []),
      { no: '1h', caption: 'Other earned income', amount: $(i.foreignEarned), plain: 'Your UK pay goes here, because a UK employer does not issue a US Form W-2.' },
      { no: '1z', caption: 'Add lines 1a through 1h', amount: $(line1z), total: true },
      { no: '2b', caption: 'Taxable interest', amount: $(i.interest) },
      { no: '3a', caption: 'Qualified dividends', amount: $(p.qualifiedDividends), plain: 'The part of your dividends taxed at the lower rates. It is included in 3b, not added to it.' },
      { no: '3b', caption: 'Ordinary dividends', amount: $(i.ordinaryDividends) },
      ...(i.pensions ? [
        { no: '5a', caption: 'Pensions and annuities', amount: $(i.pensions) },
        { no: '5b', caption: 'Taxable amount', amount: $(i.pensions) },
      ] : []),
      { no: '7a', caption: 'Capital gain or (loss)', amount: $(p.capitalIncluded) },
      { no: '8', caption: 'Additional income from Schedule 1, line 10', amount: $(sched1Line10), plain: need.f2555 ? 'Negative here because your excluded UK pay is taken off on Schedule 1.' : undefined },
      { no: '9', caption: 'Total income', amount: $(r.grossIncome - r.exclusion), total: true },
      { no: '10', caption: 'Adjustments to income from Schedule 1, line 26', amount: $(i.adjustments) },
      { no: '11a', caption: 'Adjusted gross income', amount: $(r.agi), total: true, plain: 'Your income after the exclusion and adjustments.' },
      { no: '12e', caption: r.deductionKind === 'standard' ? 'Standard deduction' : 'Itemized deductions (Schedule A)', amount: $(r.deduction) },
      { no: '14', caption: 'Add lines 12e, 13a and 13b', amount: $(r.deduction) },
      { no: '15', caption: 'Taxable income', amount: $(r.taxable), total: true },
      { no: '16', caption: 'Tax', amount: $(r.incomeTax), plain: need.f2555 ? 'Worked out on a worksheet in the IRS 1040 instructions (the "Foreign Earned Income Tax Worksheet"), which charges your other income at the rates it would bear if the excluded pay were still there.' : p.qualifiedDividends || p.capitalIncluded > 0 ? 'Worked out on a worksheet in the IRS 1040 instructions (the "Qualified Dividends and Capital Gain Tax Worksheet"), which taxes dividends and gains at the lower rates.' : undefined },
      { no: '17', caption: 'Amount from Schedule 2, line 3', amount: 0 },
      { no: '18', caption: 'Add lines 16 and 17', amount: $(r.incomeTax) },
      { no: '19', caption: 'Child tax credit or credit for other dependents from Schedule 8812', amount: $(r.childCredit) },
      { no: '20', caption: 'Amount from Schedule 3, line 8', amount: $(sched3Line8), plain: 'The foreign tax credit for UK tax.' },
      { no: '21', caption: 'Add lines 19 and 20', amount: $(line21) },
      { no: '22', caption: 'Subtract line 21 from line 18', amount: $(line22) },
      { no: '23', caption: 'Other taxes, including self-employment tax, from Schedule 2, line 21', amount: $(r.niit) },
      { no: '24', caption: 'Total tax', amount: $(r.totalTax), total: true },
      ...(i.usWithholding ? [{ no: '25d', caption: 'Federal income tax withheld', amount: $(i.usWithholding) }] : []),
      ...(i.estimatedPayments ? [{ no: '26', caption: `${i.year} estimated tax payments`, amount: $(i.estimatedPayments) }] : []),
      ...(r.childCreditRefund ? [{ no: '28', caption: 'Additional child tax credit from Schedule 8812', amount: $(r.childCreditRefund), plain: 'The child credit paid to you in cash.' }] : []),
      { no: '33', caption: 'Total payments', amount: $(line33), total: true },
      r.balance < 0
        ? { no: '34', caption: 'Overpaid — amount by which line 33 is more than line 24', amount: $(-r.balance), total: true, plain: 'The IRS owes you this. Line 35a is how much you want refunded.' }
        : { no: '37', caption: 'Amount you owe', amount: $(r.balance), total: true, plain: r.balance > 0 ? 'What you pay the IRS.' : 'Nothing to pay.' },
    ],
  });

  // --- Schedule 1 ----------------------------------------------------------
  if (need.s1) {
    forms.push({
      code: 'Sch 1',
      title: 'Schedule 1 — Additional Income and Adjustments to Income',
      plain: 'Income that does not have its own line on the 1040 — including the exclusion for UK pay, entered as a minus figure.',
      lines: [
        ...(i.rental ? [{ no: '5', caption: 'Rental real estate, royalties, partnerships, S corporations, trusts (Schedule E)', amount: $(i.rental) }] : []),
        ...(need.f2555 ? [{ no: '8d', caption: 'Foreign earned income exclusion from Form 2555', amount: $(sched1Line8d), plain: 'Your excluded UK pay, as a minus figure.' }] : []),
        ...(i.otherIncome ? [{ no: '8z', caption: 'Other income', amount: $(i.otherIncome) }] : []),
        { no: '9', caption: 'Total other income — add lines 8a through 8z', amount: $(sched1Line9) },
        { no: '10', caption: 'Combine lines 1 through 7 and 9 — to Form 1040, line 8', amount: $(sched1Line10), total: true },
        ...(i.adjustments ? [{ no: '26', caption: 'Adjustments to income — to Form 1040, line 10', amount: $(i.adjustments), total: true }] : []),
      ],
    });
  }

  // --- Schedule 2 ----------------------------------------------------------
  if (need.s2) {
    forms.push({
      code: 'Sch 2',
      title: 'Schedule 2 — Additional Taxes',
      plain: 'Extra taxes on top of income tax — here, the 3.8% investment income tax.',
      lines: [
        { no: '12', caption: 'Net investment income tax (Form 8960)', amount: $(r.niit) },
        { no: '21', caption: 'Total other taxes — to Form 1040, line 23', amount: $(r.niit), total: true },
      ],
    });
  }

  // --- Schedule 3 ----------------------------------------------------------
  if (need.s3) {
    forms.push({
      code: 'Sch 3',
      title: 'Schedule 3 — Additional Credits and Payments',
      plain: 'Where the foreign tax credit for UK tax goes onto the return.',
      lines: [
        { no: '1', caption: 'Foreign tax credit (Form 1116)', amount: $(r.ftc) },
        { no: '8', caption: 'Total — to Form 1040, line 20', amount: $(sched3Line8), total: true },
      ],
    });
  }

  // --- Schedule B ----------------------------------------------------------
  if (need.sB) {
    forms.push({
      code: 'Sch B',
      title: 'Schedule B — Interest and Ordinary Dividends',
      plain: 'Lists who paid you interest and dividends, and asks whether you have accounts outside the US.',
      lines: [
        { no: '4', caption: 'Interest — list each payer on line 1', amount: $(i.interest) },
        { no: '6', caption: 'Ordinary dividends — list each payer on line 5', amount: $(i.ordinaryDividends) },
        { no: '7a', caption: `At any time during ${i.year}, did you have a financial interest in or signature authority over a financial account in a foreign country?`, text: i.foreignAccountsMax > 0 ? 'Yes' : 'No', plain: 'Any UK bank or savings account means Yes.' },
        { no: '7a', caption: 'If Yes, are you required to file FinCEN Form 114 (FBAR)?', text: r.fbarRequired ? 'Yes' : 'No' },
        ...(r.fbarRequired ? [{ no: '7b', caption: 'Country where the account is located', text: 'United Kingdom' }] : []),
      ],
      note: 'Each payer is listed by name on lines 1 and 5. The portal holds the totals only.',
    });
  }

  // --- Schedule 8812 -------------------------------------------------------
  if (need.s8812) {
    const line12 = Math.max(0, p.ctcBeforeLimit);
    const line16a = Math.max(0, line12 - r.childCredit);
    const line16b = p.kids * rates.childTaxCreditRefundable;
    const line19 = Math.max(0, p.actcEarned - 2_500);
    forms.push({
      code: 'Sch 8812',
      title: 'Schedule 8812 — Credits for Qualifying Children and Other Dependents',
      plain: 'The child tax credit, and the part of it that can be paid to you in cash.',
      lines: [
        { no: '1', caption: 'Amount from Form 1040, line 11a', amount: $(r.agi) },
        { no: '2b', caption: 'Amounts from lines 45 and 50 of Form 2555', amount: $(r.exclusion) },
        { no: '3', caption: 'Add lines 1 and 2d', amount: $(p.ctcMagi) },
        { no: '4', caption: 'Number of qualifying children under 17 with the required SSN', text: String(p.kids) },
        { no: '5', caption: `Multiply line 4 by $${rates.childTaxCredit.toLocaleString('en-US')}`, amount: p.kids * rates.childTaxCredit },
        { no: '8', caption: 'Add lines 5 and 7', amount: p.kids * rates.childTaxCredit },
        { no: '9', caption: 'Threshold for your filing status', amount: CTC_PHASEOUT[i.status] },
        { no: '10', caption: 'Subtract line 9 from line 3, rounded up to the next $1,000', amount: p.ctcRoundedExcess },
        { no: '11', caption: 'Multiply line 10 by 5%', amount: $(p.ctcReduction) },
        { no: '12', caption: 'Subtract line 11 from line 8', amount: $(line12) },
        { no: '13', caption: 'Credit Limit Worksheet A', amount: $(p.ctcTaxLimit), plain: 'The US tax left after the foreign tax credit — the most this part can take off.' },
        { no: '14', caption: 'Smaller of line 12 or line 13 — to Form 1040, line 19', amount: $(r.childCredit), total: true },
        ...(need.f2555 ? [] : [
          { no: '16a', caption: 'Subtract line 14 from line 12', amount: $(line16a) },
          { no: '16b', caption: `Number of qualifying children × $${rates.childTaxCreditRefundable.toLocaleString('en-US')}`, amount: line16b },
          { no: '17', caption: 'Smaller of line 16a or line 16b', amount: $(Math.min(line16a, line16b)) },
          { no: '18a', caption: 'Earned income', amount: $(p.actcEarned) },
          { no: '19', caption: 'Subtract $2,500 from line 18a', amount: $(line19) },
          { no: '20', caption: 'Multiply line 19 by 15%', amount: $(line19 * 0.15) },
          { no: '27', caption: 'Additional child tax credit — to Form 1040, line 28', amount: $(r.childCreditRefund), total: true },
        ]),
      ],
      note: need.f2555 ? 'Part II (the refundable credit) is not available because Form 2555 is filed.' : undefined,
    });
  }

  // --- Form 2555 -----------------------------------------------------------
  if (need.f2555) {
    const proportion = p.daysInYear ? p.qualifyingDays / p.daysInYear : 0;
    forms.push({
      code: '2555',
      title: 'Form 2555 — Foreign Earned Income',
      plain: 'Claims the exclusion that leaves your UK pay out of the US return.',
      lines: [
        { no: '26', caption: 'Total foreign earned income', amount: $(i.foreignEarned) },
        { no: '37', caption: 'Maximum foreign earned income exclusion', amount: rates.feie },
        { no: '38', caption: `Number of days in your qualifying period that fall within ${i.year}`, text: String(p.qualifyingDays) },
        { no: '39', caption: `Line 38 divided by the number of days in ${i.year}`, text: proportion >= 1 ? '1.000' : proportion.toFixed(3) },
        { no: '40', caption: 'Multiply line 37 by line 39', amount: $(r.exclusionLimit) },
        { no: '42', caption: 'Foreign earned income exclusion — smaller of line 40 or line 41', amount: $(r.exclusion), total: true },
        { no: '45', caption: 'To Schedule 1, line 8d (as a minus figure)', amount: $(r.exclusion), total: true },
      ],
      note: 'Parts I to III — your employer, and the bona fide residence or physical presence test — are filled in by hand. The housing exclusion (Part VI) is not computed.',
    });
  }

  // --- Form 1116, one per basket -------------------------------------------
  for (const b of r.baskets) {
    if (!(b.ukTax > 0)) continue;
    const isGeneral = b.name === 'general';
    const ratio = p.gross1116 > 0 ? b.foreignGross / p.gross1116 : 0;
    const limitRatio = r.taxable > 0 ? Math.min(1, b.foreignTaxable / r.taxable) : 0;
    forms.push({
      code: `1116 ${isGeneral ? 'general' : 'passive'}`,
      title: `Form 1116 — Foreign Tax Credit (${isGeneral ? 'd. General category income' : 'c. Passive category income'})`,
      plain: isGeneral
        ? 'The credit for UK tax on your pay and pensions. One Form 1116 is filed for each type of income.'
        : 'The credit for UK tax on interest, dividends, gains and rent.',
      lines: [
        { no: 'h', caption: 'Resident of', text: 'United Kingdom' },
        { no: '1a', caption: 'Gross income from sources within the United Kingdom of this category', amount: $(b.foreignGross) },
        { no: '3a', caption: 'Standard or itemized deduction', amount: $(r.deduction) },
        { no: '3b', caption: 'Other deductions', amount: $(i.adjustments) },
        { no: '3c', caption: 'Add lines 3a and 3b', amount: $(r.deduction + i.adjustments) },
        { no: '3d', caption: 'Gross foreign source income', amount: $(b.foreignGross) },
        { no: '3e', caption: 'Gross income from all sources', amount: $(p.gross1116) },
        { no: '3f', caption: 'Divide line 3d by line 3e', text: ratio.toFixed(4) },
        { no: '3g', caption: 'Multiply line 3c by line 3f', amount: $(b.allocatedDeductions) },
        { no: '7', caption: 'Subtract line 6 from line 1a — to line 15', amount: $(b.foreignTaxable) },
        { no: '9', caption: 'Foreign taxes paid or accrued (Part II, line 8)', amount: $(isGeneral && b.highTaxed ? i.ukTaxEarnings + i.ukTaxGeneral : b.ukTax) },
        ...(b.disallowed > 0 ? [{ no: '12', caption: 'Reduction in foreign taxes', amount: $(-b.disallowed), plain: 'UK tax on the pay you excluded cannot also be credited.' }] : []),
        ...(isGeneral && b.highTaxed ? [{ no: '13', caption: 'Taxes reclassified under high tax kickout', amount: $(i.ukTaxPassive), plain: 'UK tax on investment income taxed above 37%, moved here from the passive form.' }] : []),
        { no: '14', caption: 'Foreign taxes available for credit', amount: $(b.creditable), total: true },
        { no: '15', caption: 'Amount from line 7', amount: $(b.foreignTaxable) },
        { no: '17', caption: 'Net foreign source taxable income', amount: $(b.foreignTaxable) },
        { no: '18', caption: 'Form 1040, line 11b minus line 14, plus Schedule 1-A, line 37', amount: $(r.taxable), plain: 'Your taxable income. (Schedule 1-A is not used by this portal, so its figure is nil.)' },
        { no: '19', caption: 'Divide line 17 by line 18 (not more than 1)', text: limitRatio.toFixed(4) },
        { no: '20', caption: 'Form 1040, line 16 plus Schedule 2, line 1z', amount: $(r.incomeTax) },
        { no: '21', caption: 'Multiply line 20 by line 19 — the maximum credit', amount: $(b.limitation) },
        { no: '24', caption: 'Smaller of line 14 or line 23 — to Part IV', amount: $(b.credit), total: true, plain: 'The credit allowed for this type of income.' },
      ],
      note: (b.excess > 0.5 ? `$${$(b.excess).toLocaleString('en-US')} of UK tax is more than the credit allowed. It can be carried back one year or forward ten (Schedule B of Form 1116); the portal does not track the carryover. ` : '')
        + (isGeneral ? '' : '')
        + 'Lines 2 and 4–5 (expenses, interest, losses) are not used by this portal.',
    });
  }
  if (need.f1116) {
    const g = r.baskets.find((b) => b.name === 'general');
    const pv = r.baskets.find((b) => b.name === 'passive');
    forms.push({
      code: '1116 Part IV',
      title: 'Form 1116 Part IV — Summary of Separate Credits',
      plain: 'Adds up the credit from each Form 1116.',
      lines: [
        { no: '27', caption: 'Credit for taxes on passive category income', amount: $(pv?.credit ?? 0) },
        { no: '28', caption: 'Credit for taxes on general category income', amount: $(g?.credit ?? 0) },
        { no: '32', caption: 'Add lines 25 through 31', amount: $((pv?.credit ?? 0) + (g?.credit ?? 0)) },
        { no: '33', caption: 'Smaller of line 20 or line 32', amount: $(r.ftc) },
        { no: '35', caption: 'Foreign tax credit — to Schedule 3, line 1', amount: $(r.ftc), total: true },
      ],
      note: 'Part IV is completed on one of the Forms 1116 only.',
    });
  }

  // --- Form 8960 -----------------------------------------------------------
  if (need.f8960) {
    forms.push({
      code: '8960',
      title: 'Form 8960 — Net Investment Income Tax',
      plain: 'The 3.8% tax on investment income for higher incomes.',
      lines: [
        { no: '1', caption: 'Taxable interest', amount: $(i.interest) },
        { no: '2', caption: 'Ordinary dividends', amount: $(i.ordinaryDividends) },
        { no: '4c', caption: 'Rental real estate, royalties, partnerships etc.', amount: $(i.rental) },
        { no: '5d', caption: 'Net gain or loss from disposition of property', amount: $(p.capitalIncluded) },
        { no: '8', caption: 'Total investment income', amount: $(p.nii) },
        { no: '12', caption: 'Net investment income', amount: $(p.nii) },
        { no: '13', caption: 'Modified adjusted gross income', amount: $(p.magi), plain: 'Includes the UK pay you excluded.' },
        { no: '14', caption: 'Threshold based on filing status', amount: NIIT_THRESHOLD[i.status] },
        { no: '15', caption: 'Subtract line 14 from line 13', amount: $(Math.max(0, p.magi - NIIT_THRESHOLD[i.status])) },
        { no: '16', caption: 'Smaller of line 12 or line 15', amount: $(r.niitBase) },
        { no: '17', caption: 'Net investment income tax — multiply line 16 by 3.8%', amount: $(r.niit), total: true },
      ],
    });
  }

  // --- FBAR (not an IRS form) ----------------------------------------------
  forms.push({
    code: 'FBAR',
    title: 'FinCEN Form 114 — Report of Foreign Bank and Financial Accounts',
    plain: 'Filed online through BSA E-Filing, separately from the tax return. Lists each non-US account and its highest value in the year.',
    lines: [
      { no: '—', caption: 'Highest combined value of all non-US accounts in the year', amount: $(i.foreignAccountsMax) },
      { no: '—', caption: `Required (over $${FBAR_THRESHOLD.toLocaleString('en-US')} at any time)?`, text: r.fbarRequired ? 'Yes' : 'No', total: true },
      { no: '—', caption: 'Form 8938 also required with the return?', text: r.form8938Required ? 'Yes' : 'No' },
    ],
    note: 'The FBAR lists each account separately — bank, account number and maximum value. The portal holds the combined figure only.',
  });

  return forms;
}

/**
 * The forms a year does NOT need, and why — shown as greyed-out tabs, so a
 * form she expects (Form 2555, say) is visibly accounted for rather than
 * simply absent.
 */
export function formsNotNeeded(i: UsInputs, r: UsResult): { code: string; title: string; why: string }[] {
  const shown = new Set(buildForms(i, r).map((f) => f.code));
  const all: { code: string; title: string; why: string }[] = [
    { code: 'Sch 1', title: 'Schedule 1', why: 'Nothing to put on it: no exclusion, rental income, other income or adjustments.' },
    { code: 'Sch 2', title: 'Schedule 2', why: 'No additional taxes — the 3.8% investment income tax does not apply.' },
    { code: 'Sch 3', title: 'Schedule 3', why: 'No foreign tax credit is claimed — no UK tax has been entered.' },
    { code: 'Sch B', title: 'Schedule B', why: 'Interest and dividends are each $1,500 or less and no foreign account is entered.' },
    { code: 'Sch 8812', title: 'Schedule 8812', why: 'No qualifying children entered.' },
    { code: '2555', title: 'Form 2555', why: 'The exclusion is not claimed. Tick "Claim on Form 2555" on the left and save to use it.' },
    { code: '1116 general', title: 'Form 1116 (general)', why: 'No UK tax on earnings or pensions entered.' },
    { code: '1116 passive', title: 'Form 1116 (passive)', why: r.baskets.find((b) => b.name === 'general')?.highTaxed ? 'Investment income taxed above 37% has moved to the general form.' : 'No UK tax on investment income entered.' },
    { code: '8960', title: 'Form 8960', why: 'Income is below the threshold for the 3.8% investment income tax.' },
  ];
  return all.filter((f) => !shown.has(f.code));
}
