/**
 * The glossary.
 *
 * "What does LEL mean?" is a different question from "how does PAYE work?",
 * and answering the first with the second is how this layer came to exist: the
 * topic matcher scored a threshold question against the PAYE dates topic on
 * the strength of the words "PAYE" and "NIC" alone, and answered confidently
 * about the wrong thing.
 *
 * The term index is checked BEFORE topic matching. Terms are exact — an
 * acronym or a term of art — so a hit here is a hit, and a miss falls through
 * to the topics rather than being smeared across them.
 */

import { nicRates, incomeTaxRates, pensionRates, taxYearOf, type TaxYear } from '@/lib/tax/rates';

export interface Term {
  t: string;
  full: string;
  /** The fuller topic, where there is one. */
  see?: string;
  /**
   * A definition carrying a figure is a function of the TAX YEAR. The glossary
   * is checked before the topics, so a term left reading the clock answered
   * "what is the Employment Allowance in 2024-25" with this year's £10,500 —
   * the same failure as the topics had, one layer earlier.
   */
  d: string | ((y: TaxYear) => string);
  /**
   * Answer from the glossary only when the question asks what the term MEANS.
   * The US terms are set this way: "can I claim the FEIE and the FTC" is a
   * question for the topic that compares them, not two definitions.
   */
  onlyWhenAsked?: boolean;
}

const money = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
const pc = (n: number) => (n * 100).toFixed((n * 100) % 1 ? 2 : 0) + '%';
const NIC = (y: TaxYear) => nicRates(y);
const IT = (y: TaxYear) => incomeTaxRates(y);
const PEN = (y: TaxYear) => pensionRates(y);

export const GLOSSARY: Term[] = [
  // NIC thresholds — the ones that prompted this
  { t: 'LEL', full: 'Lower Earnings Limit', see: 'nic-thresholds',
    d: (ty: TaxYear) => `${money(NIC(ty).lowerEarningsLimit)} a year. Not a payment point — the entry to the contributory benefit system. Earnings at or above it are treated as if primary contributions had been paid, so a full year at or above the LEL buys a qualifying year toward State Pension at nil NIC cost.` },
  { t: 'PT', full: 'Primary Threshold', see: 'nic-thresholds',
    d: (ty: TaxYear) => `${money(NIC(ty).primaryThreshold)} a year. Where the EMPLOYEE starts paying Class 1 NIC in cash. Below it and above the LEL, nothing is paid but entitlement still accrues.` },
  { t: 'ST', full: 'Secondary Threshold', see: 'nic-thresholds',
    d: (ty: TaxYear) => `${money(NIC(ty).secondaryThreshold)} a year. Where the EMPLOYER starts paying secondary Class 1 NIC. It sits well below the PT, so there is a band of earnings on which the employer pays and the employee does not.` },
  { t: 'UEL', full: 'Upper Earnings Limit', see: 'nic-thresholds',
    d: (ty: TaxYear) => `${money(NIC(ty).upperEarningsLimit)} a year. The ceiling of the employee's ${pc(NIC(ty).employeeMainRate)} band — not a ceiling on liability. Above it the employee still pays, at ${pc(NIC(ty).employeeUpperRate)}. There is no equivalent cap for the employer.` },
  { t: 'UST', full: 'Upper Secondary Threshold', see: 'nic-thresholds',
    d: 'The top of the 0% secondary band for under-21s. Above it the ordinary secondary rate resumes. AUST is the same for under-25 apprentices, VUST for qualifying veterans.' },
  { t: 'AUST', full: 'Apprentice Upper Secondary Threshold', see: 'nic-thresholds',
    d: 'The top of the 0% secondary band for apprentices under 25.' },
  { t: 'VUST', full: 'Veterans Upper Secondary Threshold', see: 'nic-thresholds',
    d: 'The top of the 0% secondary band for qualifying veterans in their first year of civilian employment.' },
  { t: 'EA', full: 'Employment Allowance', see: 'ea',
    d: (ty: TaxYear) => `${money(NIC(ty).employmentAllowance)} against employer secondary Class 1 NIC. One allowance across connected companies, and not available where a sole director is the only person paid above the ST.` },

  // PAYE mechanics
  { t: 'RTI', full: 'Real Time Information', see: 'paye-dates',
    d: 'The regime under which payroll is reported to HMRC on or before each payday, rather than annually. It is why the portal treats each tax month as its own return.' },
  { t: 'FPS', full: 'Full Payment Submission', see: 'paye-dates',
    d: 'The RTI return reporting what was paid and deducted. Due on or before payday.' },
  { t: 'EPS', full: 'Employer Payment Summary', see: 'paye-dates',
    d: 'The RTI return reporting reductions the FPS cannot carry — Employment Allowance, statutory payment recoveries, a nil-payment month. Due by the 19th.' },
  { t: 'P11D', full: 'Return of benefits in kind',
    d: 'The annual return of expenses and benefits provided to employees and directors, due 6 July following the tax year, with the Class 1A NIC due 22 July.' },
  { t: 'Class 1A', full: 'Class 1A NIC',
    d: 'Employer-only NIC on most benefits in kind. Reported on the P11D(b) and paid by 22 July.' },

  // Corporation tax
  { t: 'CT600', full: 'Company Tax Return', see: 'ct-dates',
    d: 'The Corporation Tax return, due 12 months after the end of the accounting period — three months after the tax itself is payable.' },
  { t: 'TTP', full: 'Taxable total profits', see: 'ct-rates',
    d: 'The figure the Corporation Tax rate is applied to. Written N in the marginal relief formula.' },
  { t: 'Augmented profits', full: 'Augmented profits', see: 'ct-rates',
    d: 'Taxable total profits plus non-group distributions received. Written A. The LIMITS are tested against A, but the relief is applied to N — which is why distributions can raise the bill without raising the profit.' },
  { t: 'QIP', full: 'Quarterly Instalment Payments', see: 'qip',
    d: 'The instalment regime for large companies. Due from 6 months and 13 days after the START of the accounting period, long before the CT600 exists.' },
  { t: 'CIHC', full: 'Close Investment Holding Company', see: 'cihc',
    d: 'A close company not existing wholly or mainly for a qualifying purpose. It loses the small profits rate and marginal relief entirely.' },
  { t: 'AA02', full: 'Dormant company accounts', see: 'dormant-accounts',
    d: 'The abbreviated accounts a dormant company files at Companies House, due 9 months after the period end.' },
  { t: 'CS01', full: 'Confirmation statement', see: 'confirmation',
    d: 'The annual confirmation of the information on the register. Due within 14 days of the review period end, required even when dormant, and a criminal offence to miss.' },

  // Personal
  { t: 'ANI', full: 'Adjusted net income', see: 'pa-taper',
    d: 'Total income less certain reliefs — grossed-up pension contributions and Gift Aid among them. It is the measure the personal allowance taper and the child benefit charge are tested against, which is why a pension contribution can recover allowance.' },
  { t: 'POA', full: 'Payment on account', see: 'poa',
    d: 'Half the preceding year’s liability, due 31 January in the tax year and 31 July after it, whether or not this year’s return exists.' },
  { t: 'HICBC', full: 'High Income Child Benefit Charge', see: 'hicbc',
    d: 'The clawback of Child Benefit through Self Assessment, tested on the higher earner’s adjusted net income.' },
  { t: 'PSA', full: 'Personal Savings Allowance',
    d: (ty: TaxYear) => {
      const y = IT(ty);
      return `${money(y.personalSavingsAllowance.basic)} for a basic-rate taxpayer, ${money(y.personalSavingsAllowance.higher)} for a higher-rate taxpayer, nil for an additional-rate taxpayer. A nil-rate band, not a deduction — it still uses rate band.`;
    } },
  { t: 'AA', full: 'Annual Allowance', see: 'annual-allowance',
    d: (ty: TaxYear) => `${money(PEN(ty).annualAllowance)} of pension input a year, counting your contributions, your employer's and anyone else's against the same figure. Tapered on high income, and unused allowance carries forward ${PEN(ty).carryForwardYears} years.` },
  { t: 'MPAA', full: 'Money Purchase Annual Allowance', see: 'annual-allowance',
    d: (ty: TaxYear) => `${money(PEN(ty).moneyPurchaseAnnualAllowance)}. Triggered by flexibly accessing a money purchase pot, after which carry forward is not available against it. Defined benefit accrual keeps an alternative annual allowance of ${money(PEN(ty).alternativeAnnualAllowance)}.` },
  { t: 'TAA', full: 'Tapered Annual Allowance', see: 'annual-allowance',
    d: (ty: TaxYear) => `The annual allowance reduced by £1 for every £2 of adjusted income above ${money(PEN(ty).taperAdjustedIncome)}, but only where threshold income also exceeds ${money(PEN(ty).taperThresholdIncome)}. It floors at ${money(PEN(ty).minimumTaperedAllowance)}.` },
  { t: 'RAS', full: 'Relief at source', see: 'pension-relief',
    d: 'You pay the contribution net of basic rate and the scheme reclaims the rest from HMRC. Higher and additional rate relief is claimed through Self Assessment, which extends both the basic rate and the higher rate limits by the gross contribution.' },
  { t: 'LSA', full: 'Lump Sum Allowance',
    d: (ty: TaxYear) => `${money(PEN(ty).lumpSumAllowance)} of tax-free lump sum across all your pensions.` },
  { t: 'LSDBA', full: 'Lump Sum and Death Benefit Allowance',
    d: (ty: TaxYear) => `${money(PEN(ty).lumpSumAndDeathBenefitAllowance)}, covering tax-free lump sums paid in life and on death.` },
  { t: 'BADR', full: 'Business Asset Disposal Relief', see: 'badr',
    d: 'Formerly Entrepreneurs’ Relief. Requires every condition met throughout the two years ending with the disposal.' },
  { t: 'PRR', full: 'Private Residence Relief',
    d: 'Relief from capital gains tax on a disposal of a dwelling that has been the taxpayer’s only or main residence, apportioned by periods of occupation.' },
  { t: 's.24', full: 'The finance cost restriction', see: 's24',
    d: 'Shorthand for the restriction of relief for residential property finance costs to a basic-rate reducer.' },
  { t: 'Form 17', full: 'Declaration of beneficial interests', see: 'form17',
    d: 'The declaration displacing the 50/50 default on jointly held property between spouses. It must reach HMRC within 60 days of its date, unextendably.' },

  // Estate
  { t: 'NRB', full: 'Nil Rate Band', see: 'iht-basics',
    d: '£325,000 of estate charged at nil. Transferable between spouses as a percentage of the band unused on the first death, applied to the band in force at the second.' },
  { t: 'RNRB', full: 'Residence Nil Rate Band', see: 'iht-basics',
    d: '£175,000 where a qualifying residence is closely inherited by a lineal descendant. Tapers away by £1 for every £2 of estate above £2m.' },
  { t: 'PET', full: 'Potentially Exempt Transfer', see: 'taper',
    d: 'A lifetime gift to an individual, exempt if the donor survives seven years and chargeable if not.' },
  { t: 'CLT', full: 'Chargeable Lifetime Transfer',
    d: 'A lifetime transfer chargeable when made — typically into a relevant property trust — at the lifetime rate, with the cumulation running for seven years.' },
  { t: 'BPR', full: 'Business Property Relief', see: 'bpr',
    d: 'Relief at 100% or 50% for qualifying business property held for two years. The 100% rate is capped by an allowance from April 2026, and the allowance itself is unresolved in the published guidance.' },
  { t: 'APR', full: 'Agricultural Property Relief', see: 'bpr',
    d: 'Relief for the agricultural value of qualifying agricultural property. Shares the April 2026 allowance with BPR.' },
  { t: 'GWR', full: 'Gift with reservation of benefit',
    d: 'A gift where the donor continues to benefit from the asset. It stays in the estate for inheritance tax, so the seven-year clock never starts.' },

  // Portal
  { t: 'Declared', full: 'Declared amount', see: 'estimate',
    d: 'What a return actually said. The only figure the portal ever charges.' },
  { t: 'Estimate', full: 'Engine estimate', see: 'estimate',
    d: 'What the portal computed from the figures entered. It informs; it is never charged and never counted as owed.' },
  { t: 'On account', full: 'Money on account', see: 'allocation',
    d: 'A payment, or part of one, not allocated to any liability. HMRC holds it. It is a real position and is not the same thing as having nothing to pay.' },
  // United States — written for someone who is not an accountant
  { t: 'IRS', full: 'Internal Revenue Service', see: 'us-why-file', onlyWhenAsked: true,
    d: 'The US tax authority — the American equivalent of HMRC.' },
  { t: '1040', full: 'Form 1040', see: 'us-forms', onlyWhenAsked: true,
    d: 'The main US tax return, filed once a year for January to December. The US equivalent of the UK Self Assessment return.' },
  { t: 'AGI', full: 'Adjusted gross income', see: 'us-deduction-brackets', onlyWhenAsked: true,
    d: 'Your total income for the year after the foreign earned income exclusion and a few adjustments, but before the standard deduction. Several US limits are measured against it.' },
  { t: 'MAGI', full: 'Modified adjusted gross income', see: 'us-ctc', onlyWhenAsked: true,
    d: 'Adjusted gross income with some items added back — for people abroad, mainly any UK earnings left out under the exclusion. Used to test whether you are over certain income limits.' },
  { t: 'Standard deduction', full: 'Standard deduction', see: 'us-deduction-brackets', onlyWhenAsked: true,
    d: 'The amount of income the US does not tax at all — like the UK personal allowance. It depends on your filing status.' },
  { t: 'Filing status', full: 'Filing status', see: 'us-filing-status', onlyWhenAsked: true,
    d: 'The category you file the US return under — single, married filing separately, married filing jointly or head of household. It sets your tax bands and standard deduction.' },
  { t: 'MFS', full: 'Married filing separately', see: 'us-filing-status', onlyWhenAsked: true,
    d: 'The usual filing status for an American married to someone who is not American. You file on your own and report only your own income.' },
  { t: 'HOH', full: 'Head of household', see: 'us-filing-status', onlyWhenAsked: true,
    d: 'A filing status for someone who pays to keep up a home for a qualifying child. Lower tax than married filing separately, and open to an American whose spouse is not American.' },
  { t: 'MFJ', full: 'Married filing jointly', see: 'us-filing-status', onlyWhenAsked: true,
    d: 'One return for both spouses. For a couple where one is not American, only possible by choosing to bring the non-American spouse\'s worldwide income into US tax.' },
  { t: 'FEIE', full: 'Foreign earned income exclusion', see: 'us-feie-ftc', onlyWhenAsked: true,
    d: 'A way of leaving UK earnings from work out of the US return altogether, up to a yearly limit. Claimed on Form 2555.' },
  { t: 'FTC', full: 'Foreign tax credit', see: 'us-feie-ftc', onlyWhenAsked: true,
    d: 'Taking the UK tax you have already paid off the US tax on the same income. Claimed on Form 1116. Usually reduces US tax on UK salary to nothing.' },
  { t: 'FBAR', full: 'Report of Foreign Bank and Financial Accounts', see: 'us-fbar-8938', onlyWhenAsked: true,
    d: 'A yearly online report of your non-US bank, savings and investment accounts, needed when they add up to more than $10,000 at any time in the year. Filed separately from the tax return. No tax is paid on it.' },
  { t: 'FinCEN', full: 'Financial Crimes Enforcement Network', see: 'us-fbar-8938', onlyWhenAsked: true,
    d: 'The part of the US Treasury that receives the FBAR. Not the IRS.' },
  { t: 'CTC', full: 'Child tax credit', see: 'us-ctc', onlyWhenAsked: true,
    d: 'Money off US tax for each child under 17 with a US Social Security number.' },
  { t: 'ACTC', full: 'Additional child tax credit', see: 'us-ctc', onlyWhenAsked: true,
    d: 'The part of the child tax credit the IRS can pay you in cash, even if you owe no US tax. Not available if you claim the foreign earned income exclusion.' },
  { t: 'NIIT', full: 'Net investment income tax', see: 'us-niit', onlyWhenAsked: true,
    d: 'An extra 3.8% US tax on investment income for people with high incomes. UK tax normally cannot be set against it.' },
  { t: 'PFIC', full: 'Passive foreign investment company', see: 'us-pfic', onlyWhenAsked: true,
    d: 'How the US classes most non-US investment funds, including most UK funds and ETFs, even inside an ISA. Taxed harshly by the US; best avoided or checked with a US preparer.' },
  { t: 'SSN', full: 'Social Security number', see: 'us-ssn', onlyWhenAsked: true,
    d: 'Your US identification number for tax. Needed on your return, and for each child you claim the child tax credit for.' },
  { t: 'ITIN', full: 'Individual Taxpayer Identification Number', see: 'us-ssn', onlyWhenAsked: true,
    d: 'A US tax number for people who cannot get a Social Security number. A non-American spouse only needs one if filing jointly. It does not qualify a child for the child tax credit.' },
  { t: 'NRA', full: 'Non-resident alien', see: 'us-filing-status', onlyWhenAsked: true,
    d: 'Someone who is neither a US citizen nor a US resident for tax — for example a British husband living in the UK. Written in place of his number on a separately filed return.' },
  { t: 'Qualified dividends', full: 'Qualified dividends', see: 'us-income-types', onlyWhenAsked: true,
    d: 'Dividends taxed at the lower US rates of 0%, 15% or 20%. Dividends from ordinary UK companies usually qualify.' },
  { t: 'Physical presence test', full: 'Physical presence test', see: 'us-feie-ftc', onlyWhenAsked: true,
    d: 'One way to qualify for the foreign earned income exclusion: being outside the US for at least 330 full days in a 12-month period.' },
  { t: 'Bona fide residence', full: 'Bona fide residence test', see: 'us-feie-ftc', onlyWhenAsked: true,
    d: 'The other way to qualify for the foreign earned income exclusion: genuinely living in another country for a whole calendar year. Someone settled in the UK usually meets it.' },
  { t: 'Totalization', full: 'Totalization agreement', see: 'us-se-tax', onlyWhenAsked: true,
    d: 'The US–UK agreement that makes sure you only pay into one country\'s social security — National Insurance or US Social Security — not both.' },
  { t: '2555', full: 'Form 2555', see: 'us-feie-ftc', onlyWhenAsked: true, d: 'The form for claiming the foreign earned income exclusion.' },
  { t: '1116', full: 'Form 1116', see: 'us-feie-ftc', onlyWhenAsked: true, d: 'The form for claiming the foreign tax credit — one for each type of income.' },
  { t: '8812', full: 'Schedule 8812', see: 'us-ctc', onlyWhenAsked: true, d: 'The schedule for the child tax credit and the refundable additional child tax credit.' },
  { t: '8938', full: 'Form 8938', see: 'us-fbar-8938', onlyWhenAsked: true, d: 'A list of foreign financial assets filed with the tax return, needed only above much higher limits than the FBAR.' },
  { t: '4868', full: 'Form 4868', see: 'us-deadlines', onlyWhenAsked: true, d: 'Asks for more time to file the US return, to 15 October. It does not give more time to pay.' },
  { t: '3520', full: 'Form 3520', see: 'us-gifts-spouse', onlyWhenAsked: true, d: 'Reports large gifts from a non-American — over $100,000 in a year — such as transfers from a British spouse.' },
  { t: '5471', full: 'Form 5471', see: 'us-uk-company', onlyWhenAsked: true, d: 'An information form about a non-US company, needed by Americans who hold 10% or more of one, or who are its directors when such shares change hands.' },
  { t: '8960', full: 'Form 8960', see: 'us-niit', onlyWhenAsked: true, d: 'The form for the 3.8% net investment income tax.' },
];

export const termText = (g: Term, year?: TaxYear): string => {
  const y = year ?? taxYearOf(new Date());
  try { return typeof g.d === 'function' ? g.d(y) : g.d; }
  catch { return `The portal holds no rate table for ${y}, so this figure is not stated.`; }
};

/** Does this definition change with the tax year? */
export const isYearSensitiveTerm = (g: Term): boolean => typeof g.d === 'function';

/**
 * Exact term lookup. Acronyms match case-insensitively as whole words; longer
 * terms match as a phrase. No fuzzy matching — a near miss here should fall
 * through to the topics, not guess.
 */
export function glossaryHits(q: string): Term[] {
  const l = ' ' + q.toLowerCase().replace(/[^a-z0-9.\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const out: Term[] = [];
  for (const g of GLOSSARY) {
    const t = g.t.toLowerCase();
    if (l.includes(' ' + t + ' ') || l.includes(' ' + t + 's ') || l.includes(' ' + g.full.toLowerCase() + ' ')) {
      out.push(g);
    }
  }
  return out;
}

/** Is this a question about what something MEANS, rather than how it works? */
export const isDefinitional = (q: string) =>
  /\b(what (do|does|is|are)|meaning|means?\b|stand for|abbreviat|acronym|define|definition|terminology|jargon)\b/i.test(q);
