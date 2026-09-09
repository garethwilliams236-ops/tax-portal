/**
 * IVOR — the authority table.
 *
 * Every figure Ivor states comes from here or from the live ledger, and every
 * figure here is drawn from the SAME dated rate tables the engine computes
 * with, so the explanation and the calculation cannot drift apart. Nothing in
 * this table is produced by a language model.
 *
 * `judgement` is the important field. Where HMRC's stated view and the case
 * law or the statute pull in different directions, the topic says so and names
 * both. The reader is a chartered accountant filing his own returns: the job
 * is to put the competing authority in front of him, not to pick for him and
 * not to defer to an adviser he does not have.
 *
 * `KB_VERIFIED` is the date the content was last checked against GOV.UK and
 * the HMRC manuals. Treat anything older than a Budget as suspect.
 */

import {
  corporationTaxRates, nicRates, incomeTaxRates, pensionRates, yearsCovered, taxYearOf,
  type TaxYear,
} from '@/lib/tax/rates';
import { ratesSummary } from './rates-summary';

export const KB_VERIFIED = '2026-08-31';

export interface Topic {
  id: string;
  t: string;
  tags: string;
  /**
   * Content that involves a figure is a FUNCTION OF THE TAX YEAR, not of the
   * clock. Asking for the 2024-25 Employment Allowance and being shown this
   * year's is the failure this signature prevents.
   */
  what: string | ((y: TaxYear) => string);
  detail?: string[] | ((y: TaxYear) => string[]);
  judgement?: string;
  cites?: [string, string][];
  /**
   * When THIS topic was last checked, where that differs from KB_VERIFIED.
   * The table's floor date is honest about the oldest entry; a topic checked
   * since should say so rather than inherit a staler date.
   */
  verified?: string;
}

const money = (n: number) => '£' + Math.round(n).toLocaleString('en-GB');
const pc = (n: number) => (n * 100).toFixed((n * 100) % 1 ? 2 : 0) + '%';

/**
 * Rates are read at call time for a NAMED year, not at module load and not
 * from the clock. A year with no table throws, and kbField turns that into a
 * plain statement that the portal does not hold it.
 *
 * Corporation Tax runs on financial years from 1 April, so a tax year is
 * mapped to the financial year it mostly sits in.
 */
const midYear = (y: TaxYear) => new Date(Date.UTC(Number(y.slice(0, 4)), 5, 1));
const CT = (y: TaxYear) => corporationTaxRates(midYear(y));
const NIC = (y: TaxYear) => nicRates(y);
const IT = (y: TaxYear) => incomeTaxRates(y);
const PEN = (y: TaxYear) => pensionRates(y);
export const currentTaxYear = () => taxYearOf(new Date());

export const KB: Topic[] = [
  // --- How the portal works ------------------------------------------------
  {
    id: 'ledger', t: 'Return, then liability, then payment',
    tags: 'ledger process outstanding owe owing sequence how works declared charge order why',
    what: 'The portal follows the real sequence. You report first, and the return declares the amount. A liability exists because a return declared it, or because statute charged it in advance. Payments are allocated to a named liability. Outstanding is arithmetic — liability less allocations — never a status anyone ticked.',
    detail: [
      'Until a return is filed, nothing is charged. The engine figure you see before then is an estimate: it informs, it is not a debt, and it is labelled as one.',
      'A payment on account or a quarterly instalment is the exception that proves the rule — it is charged by statute before any return exists, which is exactly why it cannot be modelled as something a return produces.',
      'A payment that is not allocated sits as money on account. That is a real position and is reported separately. It is not the same thing as having nothing to pay.',
    ],
    cites: [['Portal design', 'Migration 0003_ledger.sql enforces this: a return charge must name a filed return carrying a declared amount.']],
  },
  {
    id: 'estimate', t: 'Estimate versus declared',
    tags: 'estimate declared engine computed variance difference why',
    what: 'An estimate is what the engine computed from the figures you entered. A declared amount is what the return actually said. Only the declared amount is ever charged.',
    detail: [
      'Where both exist the portal keeps the estimate and shows the variance, so a disagreement between your computation and what was filed stays visible rather than being silently overwritten.',
      'A variance is only shown where the engine had inputs. With no income or profit entered the engine returns nil, and reporting your declared figure as being above a computed nil would be a fabricated disagreement.',
    ],
    cites: [['Portal design', 'tax_returns.declared_amount is authoritative; estimate_amount is never charged.']],
  },
  {
    id: 'allocation', t: 'Allocating a payment',
    tags: 'allocate allocation oldest first credit account unallocated apply payment which debt',
    what: 'A payment is allocated to a named liability. The default is oldest debt first, which is how HMRC applies a payment reaching it without instruction, and it is the right default because interest runs from the oldest due date.',
    detail: [
      'You can override the allocation. Anything you leave unallocated stays as money on account rather than being forced onto a debt.',
      'A repayment received from HMRC reduces what is on account, or reverses against the liability it was drawn from where you allocate it that way.',
    ],
    cites: [['Portal design', 'payment_allocations, with a trigger refusing to allocate more of a payment than the payment was for.']],
  },
  {
    id: 'per-period', t: 'Why figures are held per period',
    tags: 'period year figures saved separate leak across every one shared computation inputs payroll',
    what: 'Every figure you enter belongs to one period. Computation inputs are keyed on entity, tax and period; pay is keyed on the person and the tax year; property figures on the property and the tax year. Nothing is stored anywhere that is not pinned to a period.',
    detail: [
      'Pay and property figures are deliberately held apart from the person and the property themselves. The record is durable; what it earned or was paid is a fact about a year.',
      'Only the inputs are stored. The result is recomputed from them and the dated rate tables on every render, so a corrected rate reaches every historic screen at once.',
    ],
    cites: [['Portal design', 'Migrations 0006 and 0007: unique on (entity, tax, period) and on (record, tax year).']],
  },

  {
    id: 'rates',
    verified: '2026-09-09',
    t: 'Rates and thresholds',
    tags: 'rates thresholds allowances year figures headline summary personal allowance bands 2024 2025 2026 2027',
    // Written for the CURRENT year here. Where a question names a year, the
    // answer is rebuilt for THAT year — see ratesSummary. The topic used to
    // read the year off the clock with no way to take one, so a question about
    // 2024 was answered with 2026-27 figures and no hint it had been ignored.
    what: (ty: TaxYear) => ratesSummary(ty).what,
    detail: (ty: TaxYear) => {
      const cov = yearsCovered();
      return [
        ...ratesSummary(ty).detail,
        `Full rate tables are held for ${cov.incomeTax.join(', ')} on income tax and ${cov.nic.join(', ')} on NIC. Ask for a year by name to see that year.`,
      ];
    },
    cites: [
      ['GOV.UK', 'Income Tax rates and allowances: current and past.'],
      ['GOV.UK', 'Rates and thresholds for employers.'],
      ['GOV.UK', 'Rates and allowances: Corporation Tax.'],
      ['GOV.UK', 'Pension schemes rates.'],
    ],
  },

  // --- Corporation Tax -----------------------------------------------------
  {
    id: 'ct-rates', t: 'Corporation Tax rates and the marginal band',
    tags: 'corporation ct rate rates marginal relief small profits limits threshold band effective augmented',
    what: (ty: TaxYear) => {
      const c = CT(ty);
      return `The small profits rate is ${pc(c.smallProfitsRate)} up to the lower limit of ${money(c.lowerLimit)}; the main rate is ${pc(c.mainRate)}. Between the limits, marginal relief tapers the main rate, giving an effective marginal rate of 26.5% on profits in the band.`;
    },
    detail: (ty: TaxYear) => {
      const c = CT(ty);
      return [
        `Marginal relief = F × (U − A) × (N ÷ A), where F is 3/200, U is the upper limit ${money(c.upperLimit)}, A is augmented profits and N is taxable total profits.`,
        'Augmented profits (A) are taxable total profits plus non-group distributions received. The limits are tested against A, but the relief is applied to N — which is why a company with distributions can pay more without earning more.',
        'Both limits are divided by the number of associated companies plus one, and by the length of the accounting period where it is shorter than 12 months.',
      ];
    },
    cites: [['CTA 2010 Part 3, Ch 3A', 'Marginal relief.'], ['CTM03935', 'HMRC on the computation.']],
  },
  {
    id: 'association', t: 'Associated companies',
    tags: 'associated association associate divide limits two companies dormant control interdependence',
    what: 'Two companies are associated if one controls the other, or both are under common control, and the limits divide by the number of associates plus one. A company that has not carried on a trade or business at any time in the accounting period is disregarded.',
    detail: [
      'The disregard is tested PER ACCOUNTING PERIOD, per company, and it is the subject company’s period that governs — not the associate’s year end.',
      'The test is trade-or-business, not Companies Act dormancy. They are different tests and a company can fail one and pass the other.',
      'A company associated for any part of a period counts for the WHOLE of it. There is no apportionment.',
    ],
    judgement: 'Where control exists but the companies are not commercially interdependent, association still follows from control alone — the substantial commercial interdependence test only extends association, it does not relieve it. Bank interest alone is not a business (Jowett v O’Neill & Brennan), but HMRC will look at what the company actually did, not what its accounts are labelled. This is a judgement on facts and the portal records your determination and reasoning rather than deciding it.',
    cites: [
      ['CTA 2010 s.18E', 'The trade-or-business disregard.'],
      ['CTA 2010 s.18F', 'Passive holding companies.'],
      ['CTM03940', 'HMRC on associated companies.'],
      ['CTM03956', 'No apportionment for part-period association.'],
      ['Jowett v O’Neill & Brennan Construction Ltd', 'Bank interest alone is not a business.'],
    ],
  },
  {
    id: 'trade-start', t: 'The trade-start trap',
    tags: 'start trading dormant begins commence halve limits retrospective whole period trap',
    what: 'If a dormant company starts to trade, the trading company’s Corporation Tax limits halve for the ENTIRE accounting period in which it starts — retrospectively, back to the first day.',
    detail: [
      'One day of trading in a 12-month period has the same effect as twelve months of it. There is no apportionment.',
      'Where you control the start date, starting on the first day of a new accounting period confines the effect to a period you have planned for.',
      'This is the highest-value thing the portal watches, because it is invisible until the computation and irreversible by then.',
    ],
    cites: [['CTA 2010 s.18E(1)', 'Associated for any part of a period counts for the whole.'], ['CTM03956', '']],
  },
  {
    id: 'ct-dates', t: 'Corporation Tax dates',
    tags: 'ct600 deadline nine months twelve filing corporation payable',
    what: 'Corporation Tax is payable 9 months and 1 day after the end of the accounting period. The CT600 is due 12 months after the end of the period — three months after the money.',
    detail: [
      'The payment comes first. That ordering catches people out: the tax is due before the return that declares it, which is why the portal charges the liability on filing but dates it to the payment deadline.',
      'Large companies pay by quarterly instalments instead, from 6 months and 13 days after the START of the period.',
    ],
    cites: [['FA 1998 Sch 18', 'Company tax returns.'], ['CTA 2010', 'Payment date.']],
  },
  {
    id: 'qip', t: 'Quarterly instalment payments',
    tags: 'qip quarterly instalment large company augmented instalments',
    what: (ty: TaxYear) => `Quarterly instalments apply where augmented profits exceed ${money(CT(ty).qipThreshold)}, divided by the number of associated companies plus one.`,
    detail: [
      'Instalments fall due 6 months and 13 days after the START of the accounting period, then at 3-month intervals. For a 12-month period the last one lands 3 months and 14 days after the period end.',
      'They are charged on an estimate by design — the money is due long before the CT600 exists — so the portal flags them as estimated and reconciles them when the return is filed.',
      'A company crossing the threshold for the first time gets a year’s grace unless profits exceed £10m.',
    ],
    cites: [['SI 1998/3175 reg 5', 'The instalment dates.'], ['CTM92500', 'HMRC on instalments.']],
  },
  {
    id: 'cihc', t: 'Close investment holding companies',
    tags: 'cihc close investment holding denied',
    what: 'A close investment holding company cannot use the small profits rate or marginal relief. It pays the main rate on the whole of its profits.',
    detail: [
      'A close company is a CIHC unless it exists wholly or mainly for a qualifying purpose — carrying on a trade commercially, or holding property let to unconnected parties.',
      'This is the flag most likely to be wrong on a company that has stopped trading but still holds assets.',
    ],
    cites: [['CTA 2010 s.34', 'The CIHC definition and effect.']],
  },
  {
    id: 'ct-notify', t: 'Notifying HMRC a company is within the charge',
    tags: 'notify notification within charge three months chargeable new company',
    what: 'A company coming within the charge to Corporation Tax must notify HMRC within 3 months of the START of the accounting period — not the year end.',
    detail: [
      'Three months from the start of the period, so for a company that begins trading on 1 April the deadline is 30 June, long before any accounts exist.',
      'Missing it is a penalty in its own right, separate from anything to do with the return.',
    ],
    cites: [['FA 2004 s.55', 'Duty to notify.']],
  },

  // --- VAT -----------------------------------------------------------------
  {
    id: 'vat-dates', t: 'VAT return and payment deadline',
    tags: 'vat deadline quarter one month seven days return payment box',
    what: 'A VAT return and the payment are both due one calendar month and 7 days after the end of the period — which lands on the 7th of the SECOND month after the quarter end.',
    detail: [
      'A quarter ending 30 September is due 7 November, not 6 November. Naive month arithmetic gets this wrong by a day every quarter, so the portal computes it as the 7th of the second month rather than by adding intervals.',
      'The liability is box 5 on the return. The portal charges what you declare, not what the books derived.',
    ],
    cites: [['VAT Regs 1995 reg 25/40', 'Return and payment.'], ['VATPOA', 'Payments on account for large traders.']],
  },

  // --- PAYE and NIC --------------------------------------------------------
  {
    id: 'paye-dates', t: 'PAYE and NIC payment dates',
    tags: 'paye monthly 22nd 19th deadline rti fps eps payroll',
    what: 'PAYE and NIC for a tax month are due by the 22nd of the following tax month where you pay electronically, or the 19th by post. The tax month runs to the 5th.',
    detail: [
      'The FPS is due on or before payday; the EPS by the 19th where you are claiming a reduction.',
      'The portal treats each tax month as its own return, because that is what RTI makes it: a monthly declaration that charges a monthly liability.',
    ],
    cites: [['SI 2003/2682 reg 69', 'Payment dates.']],
  },
  {
    id: 'nic-thresholds', t: 'The NIC thresholds',
    tags: 'lel pt st uel ust threshold thresholds limit lower earnings primary secondary upper class contributions qualifying',
    what: (ty: TaxYear) => {
      const n = NIC(ty);
      return `Four thresholds run the Class 1 calculation. The Lower Earnings Limit is ${money(n.lowerEarningsLimit)}, the Primary Threshold ${money(n.primaryThreshold)}, the Secondary Threshold ${money(n.secondaryThreshold)} and the Upper Earnings Limit ${money(n.upperEarningsLimit)}.`;
    },
    detail: (ty: TaxYear) => {
      const n = NIC(ty);
      return [
        `LEL: not a payment point. Earnings at or above it are treated as if primary contributions had been paid, so a full year at or above ${money(n.lowerEarningsLimit)} buys a qualifying year toward State Pension at nil cost.`,
        `PT: where the EMPLOYEE starts paying, at ${pc(n.employeeMainRate)}. Below it and above the LEL nothing is paid but entitlement still accrues.`,
        `ST: where the EMPLOYER starts paying, at ${pc(n.employerRate)}. It sits well below the PT, so there is a band on which the employer pays and the employee does not.`,
        `UEL: the ceiling of the employee’s main band, not a ceiling on liability. Above ${money(n.upperEarningsLimit)} the employee still pays, at ${pc(n.employeeUpperRate)}. There is no equivalent cap for the employer.`,
        'Published annual figures are not simply 52 times the weekly ones, so the annual thresholds are held directly rather than derived.',
      ];
    },
    cites: [
      ['NIM01203', 'Lower Earnings Limit.'],
      ['NIM01204', 'Primary Threshold.'],
      ['NIM01207', 'Secondary Threshold.'],
      ['NIM01007', 'Upper Earnings Limit.'],
    ],
  },
  {
    id: 'ea', t: 'Employment Allowance',
    tags: 'employment allowance secondary two directors sole director connected one claim',
    what: (ty: TaxYear) => {
      const n = NIC(ty);
      return `The Employment Allowance is ${money(n.employmentAllowance)} against employer secondary Class 1 NIC. The restriction bites on a company where a SINGLE DIRECTOR is the only person paid above the secondary threshold of ${money(n.secondaryThreshold)}.`;
    },
    detail: (ty: TaxYear) => {
      const n = NIC(ty);
      return [
        `The test counts heads paid above the secondary threshold — not directorships. A second director appointed but paid nothing does not secure the allowance; a part-time employee paid above ${money(n.secondaryThreshold)} does.`,
        'Only ONE allowance is available across connected companies, and connection is tested at the beginning of the tax year.',
        `Paying a second person above ${money(n.secondaryThreshold)} at any point in the tax year secures the allowance for the whole of that year, so this is worth acting on before 5 April rather than after.`,
      ];
    },
    judgement: 'It is easy to state this as "a two-director company qualifies". It does not — a second director who is paid nothing changes nothing. The statutory test is whether anyone other than a sole director has earnings attracting secondary Class 1 in the year. The wider eligibility conditions have not been confirmed against a primary source in this portal and should be checked before relying on them.',
    cites: [
      ['NICA 2014 s.2(4A)', 'The single-director restriction.'],
      ['NICA 2014 s.3', 'Connected companies: one allowance.'],
      ['NIM06545', 'HMRC on the single-director test.'],
    ],
  },

  // --- Self Assessment -----------------------------------------------------
  {
    id: 'sa-dates', t: 'Self Assessment dates',
    tags: 'self assessment deadline january filing balancing personal',
    what: 'The return and the balancing payment are both due 31 January following the end of the tax year. Payments on account fall due 31 January within the year and 31 July after it.',
    detail: [
      'So for 2025/26: first payment on account 31 January 2026, second 31 July 2026, return and balancing payment 31 January 2027.',
      'Paper returns are due 31 October, which matters only if you file on paper.',
    ],
    cites: [['TMA 1970 s.8', 'The return.'], ['TMA 1970 s.59B', 'Balancing payment.']],
  },
  {
    id: 'poa', t: 'Payments on account',
    tags: 'payment account poa half prior preceding minimis deducted source charged',
    what: 'Each payment on account is 50% of the PRECEDING year’s liability, and is due whether or not this year’s return exists. That is why the portal charges them before you file.',
    detail: [
      'Not required where the preceding year’s liability was under £1,000, or where 80% or more of that liability was met by deduction at source.',
      'The base is income tax and Class 4 NIC. It excludes capital gains tax and Class 2 NIC, so a year with a large gain does not inflate next year’s instalments.',
      'The balancing payment is then this year’s declared liability less the two payments on account. Where they overshot, it is negative and a repayment is due.',
    ],
    cites: [['TMA 1970 s.59A', 'Payments on account.'], ['SAM1010', 'HMRC on the de minimis tests.']],
  },
  {
    id: 'pa-taper', t: 'The personal allowance taper and the 60% band',
    tags: 'personal allowance taper adjusted net income lost 60 marginal',
    what: (ty: TaxYear) => {
      const y = IT(ty);
      return `The personal allowance of ${money(y.personalAllowance)} is withdrawn by £1 for every £2 of adjusted net income above ${money(y.paTaperThreshold)}, producing an effective marginal rate of 60% across the band.`;
    },
    detail: [
      'The taper is on adjusted net income, so a pension contribution or Gift Aid payment reduces it pound for pound and can recover allowance at an effective 60% relief.',
      'The band is where the largest single planning gain usually sits, and it is invisible on a rate table.',
    ],
    cites: [['ITA 2007 s.35 / s.58', 'Personal allowance and adjusted net income.']],
  },
  {
    id: 's24', t: 'The finance cost reducer',
    tags: 'finance cost reducer mortgage interest property landlord basic rate residential',
    what: 'Finance costs on residential property are not deductible from property income. Instead a basic-rate reducer of 20% is given against the tax, limited to the lowest of finance costs, property profits and adjusted total income.',
    detail: [
      'Because the reducer stays at the basic rate while property income rates are announced to rise 2pp from 6 April 2027, the gap widens. That is deliberate, not a rounding problem in the computation.',
      'The restriction does not apply to commercial property or to companies.',
    ],
    cites: [['ITTOIA 2005 s.272A / ITA 2007 s.274A', 'The restriction and the reducer.']],
  },
  {
    id: 'form17', t: 'Form 17 and jointly held property',
    tags: 'form joint property spouse beneficial split declaration unequal 60 days',
    what: 'Property held jointly by spouses is taxed 50/50 regardless of actual beneficial ownership, unless a Form 17 declaration is in force. The declaration must reach HMRC within 60 days of its date, and there is no power to extend.',
    detail: [
      'Form 17 requires genuinely unequal beneficial interests and must state the true position. It cannot be used to allocate income away from the beneficial owner.',
      'The 60 days runs from the DATE OF THE DECLARATION, not from the deed of trust and not from the start of the tax year. A late declaration is simply void and you start again.',
      'Close company shares are Exception D: actual entitlement always applies and no Form 17 is possible or needed.',
    ],
    judgement: 'The 60-day limit is unextendable — TSEM9862 is explicit and there is no discretion to appeal to. The portal treats it as an unextendable deadline and flags it differently from everything else for that reason.',
    cites: [['ITA 2007 s.836', 'The 50/50 rule.'], ['ITA 2007 s.837', 'The declaration.'], ['TSEM9862', '60 days, no power to extend.']],
  },
  {
    id: 'settlements', t: 'Dividends to a spouse and the settlements legislation',
    tags: 'settlement settlements spouse dividend garnett outright gift shares alphabet',
    what: 'A gift of shares between spouses escapes the settlements legislation under the outright gift exception, provided the shares are ordinary shares carrying full rights and the gift is unconditional.',
    detail: [
      'The shares must carry votes, full dividend rights AND capital on a winding up. A share stripped of capital rights is not an outright gift of property.',
      'The gift must be unconditional with no reversion to the donor.',
      'Jones v Garnett settled this for ordinary shares gifted between spouses. It did not bless every alphabet share arrangement.',
    ],
    judgement: 'Where the shares are a separate class with restricted rights, or the arrangement includes any understanding about how dividends will be applied, the exception is at risk. HMRC’s view and the decided cases diverge on how far the exception stretches, and this is a facts-and-circumstances judgement.',
    cites: [['ITTOIA 2005 s.624', 'The settlements charge.'], ['ITTOIA 2005 s.626', 'The outright gift exception.'], ['Jones v Garnett [2007] UKHL 35', '']],
  },
  {
    id: 'hicbc', t: 'High Income Child Benefit Charge',
    tags: 'hicbc child benefit charge clawback adjusted net income',
    what: (ty: TaxYear) => {
      const y = IT(ty);
      const step = Math.round((y.hicbcUpper - y.hicbcLower) / 100);
      return `The charge claws back Child Benefit at 1% for every £${step} of adjusted net income above ${money(y.hicbcLower)}, so it is fully withdrawn at ${money(y.hicbcUpper)}.`;
    },
    detail: [
      'It falls on the higher earner of the couple, which is not necessarily the claimant.',
      'It is charged through Self Assessment, so it forms part of the liability that drives next year’s payments on account.',
    ],
    cites: [['ITEPA 2003 Part 10 Ch 8', 'The charge.']],
  },

  // --- Pensions ------------------------------------------------------------
  {
    id: 'pension-relief',
    verified: '2026-09-09', t: 'Relief on a personal pension contribution',
    tags: 'pension contribution contributions relief personal relieved higher additional rate band extension source net pay marginal',
    what: 'A personal contribution is relieved at your marginal rate. Under relief at source you pay net of basic rate and the scheme reclaims the rest from HMRC; higher and additional rate relief is claimed on the Self Assessment return. Under a net pay arrangement the employer deducts the contribution from gross pay and full relief is given through PAYE.',
    detail: [
      'The higher-rate claim works by extending the rate bands, not by a repayment of a fixed percentage. BOTH the basic rate limit and the higher rate limit are increased by the gross contribution (PTM056120), which is why a contribution can be worth more than 40% to someone near the additional rate threshold.',
      'A gross contribution also reduces adjusted net income. That is a separate effect from the rate band extension and it is what recovers personal allowance in the taper band and reduces the child benefit charge.',
      'For a relief-at-source contribution, adjusted net income falls by the GROSSED-UP amount: £1.25 for every £1 actually paid.',
      'Employee contributions get no National Insurance relief. NIC is assessed on gross earnings before any pension deduction (NIM02365). Employer contributions are different — see the employer topic.',
    ],
    cites: [
      ['FA 2004 s.188–192', 'Member relief.'],
      ['PTM044220', 'Relief at source.'],
      ['PTM044230', 'Net pay arrangement.'],
      ['PTM056120', 'Both limits extended by the gross contribution.'],
      ['ITA 2007 s.58', 'Adjusted net income.'],
      ['NIM02365', 'No NIC relief on employee contributions.'],
    ],
  },
  {
    id: 'annual-allowance',
    verified: '2026-09-09', t: 'The annual allowance, the taper and carry forward',
    tags: 'annual allowance mpaa money purchase tapered taper threshold adjusted carry forward unused input charge',
    what: (ty: TaxYear) => {
      const p = PEN(ty);
      return `The annual allowance is ${money(p.annualAllowance)}. It is tapered by £1 for every £2 of adjusted income above ${money(p.taperAdjustedIncome)}, but only where threshold income also exceeds ${money(p.taperThresholdIncome)}, and it cannot fall below ${money(p.minimumTaperedAllowance)}.`;
    },
    detail: (ty: TaxYear) => {
      const p = PEN(ty);
      return [
        `The pension input amount counts EVERYTHING paid in the input period — by you, by your employer, and by anyone else on your behalf — against the same allowance. There is no separate employer allowance.`,
        `Both tests must be met for the taper to bite. Threshold income above ${money(p.taperThresholdIncome)} on its own does nothing if adjusted income is below ${money(p.taperAdjustedIncome)}.`,
        `Triggering the money purchase annual allowance reduces money-purchase saving to ${money(p.moneyPurchaseAnnualAllowance)}, with an alternative annual allowance of ${money(p.alternativeAnnualAllowance)} for defined benefit accrual. Carry forward is not available against the MPAA.`,
        `Unused allowance carries forward from the previous ${p.carryForwardYears} tax years. The current year's allowance is used first, then unused allowance earliest year first.`,
        'Carry forward requires membership of a registered pension scheme in each year carried forward from — active, deferred, pensioner or pension credit membership all count.',
        'The annual allowance charge is the individual’s liability, not the scheme’s, and is reported through Self Assessment.',
      ];
    },
    cites: [
      ['FA 2004 s.227–228ZA', 'The annual allowance and the taper.'],
      ['PTM051100', 'Essential principles; the input amount counts all contributions.'],
      ['PTM057100', 'Tapered annual allowance.'],
      ['PTM055100', 'Carry forward.'],
      ['PTM055200', 'Calculating unused allowance.'],
    ],
  },
  {
    id: 'employer-pension',
    verified: '2026-09-09', t: 'Employer pension contributions',
    tags: 'employer company contribution pension director corporation deduction wholly exclusively salary sacrifice nic',
    what: 'An employer contribution to a registered scheme is free of National Insurance and is not taxed on the employee. It is deductible for Corporation Tax in the period paid, subject to the wholly and exclusively test.',
    detail: [
      'The wholly and exclusively test is applied to the TOTAL remuneration package, not to the pension contribution in isolation (BIM46035). HMRC challenges only where the package as a whole is excessive for the value of the work done, and accepts packages comparable with those paid to unconnected employees doing work of similar value.',
      'The contribution still counts against the individual’s annual allowance. Employer generosity does not create extra allowance.',
      'Relief is given for the period in which the contribution is PAID, not accrued, so a contribution paid after the year end falls into the following period.',
      'From 6 April 2029, salary-sacrifice pension contributions above £2,000 a year become subject to both employer and employee NIC. The income tax exemption is unchanged. That is a forward-dated rule, not a 2026-27 one.',
    ],
    cites: [
      ['FA 2004 s.196', 'Employer contributions: relief.'],
      ['BIM46035', 'Wholly and exclusively, applied to the whole package.'],
      ['NIM02716', 'No Class 1 NIC on employer contributions.'],
      ['PTM043100', 'Employer contributions.'],
    ],
  },

  // --- Capital gains -------------------------------------------------------
  {
    id: 'badr', t: 'Business Asset Disposal Relief',
    tags: 'badr entrepreneurs cgt lifetime limit shares disposal trading',
    what: 'BADR requires the conditions to be met throughout the two years ending with the disposal: 5% of ordinary share capital and votes, entitlement to 5% of distributable profits and of assets on a winding up, employee or officer, and the company a trading company.',
    detail: [
      'All of the conditions must be satisfied continuously. A share reorganisation or a change of employment status restarts the clock.',
      'The lifetime limit is £1m of qualifying gains.',
      'The portal records the date from which all conditions have been continuously met, because that date — not the acquisition date — is what the two years run from.',
    ],
    judgement: '"Trading company" is a facts test with a substantial non-trading activities gloss. A company holding significant surplus cash or investment property may fail it, and HMRC’s 20% rule of thumb is guidance rather than statute.',
    cites: [['TCGA 1992 s.169I', 'The disposal conditions.'], ['TCGA 1992 s.169S', 'Personal company and trading company.']],
  },
  {
    id: 'cgt-60day', t: 'The 60-day residential property return',
    tags: 'residential completion report disposal separate return capital gains',
    what: 'A disposal of UK residential property giving rise to a gain must be reported and the tax paid within 60 days of completion, on a separate return from Self Assessment.',
    detail: [
      'It runs alongside the Self Assessment return, not instead of it. The gain goes on both.',
      'No return is required where no tax is due — for example where the gain is fully covered by private residence relief.',
    ],
    cites: [['TCGA 1992 Sch 2 para 3', 'The 60-day return.'], ['CG-APP18', 'HMRC guidance.']],
  },
  {
    id: 'spouse-transfer', t: 'Transfers between spouses',
    tags: 'spouse transfer gain loss inter spousal base cost equalise',
    what: 'Transfers between spouses living together are on a no-gain-no-loss basis: the transferee takes over the transferor’s base cost, and no gain arises on the transfer itself.',
    detail: [
      'This is the mechanism behind equalising a gain across two annual exempt amounts and two sets of rate bands.',
      'It applies for the whole of the tax year of separation, then stops.',
    ],
    cites: [['TCGA 1992 s.58', 'No gain no loss.']],
  },

  // --- Estate --------------------------------------------------------------
  {
    id: 'iht-basics', t: 'Inheritance tax on the estate',
    tags: 'iht inheritance nil rate band nrb rnrb residence transferable spouse exemption estate',
    what: 'The nil rate band is £325,000 and the residence nil rate band £175,000, both transferable between spouses. Transfers between spouses are exempt without limit. The rate above the bands is 40%.',
    detail: [
      'The RNRB requires a qualifying residence closely inherited by a LINEAL descendant. Nieces, nephews and siblings do not qualify.',
      'The RNRB tapers away by £1 for every £2 of estate above £2m.',
      'A transferable band is claimed as a percentage of the band unused on the first death, applied to the band in force at the second — so it is not a fixed cash amount.',
    ],
    cites: [['IHTA 1984 s.7', 'Rates.'], ['IHTA 1984 s.18', 'Spouse exemption.'], ['IHTA 1984 s.8A–8M', 'Transferable bands and RNRB.']],
  },
  {
    id: 'taper', t: 'Taper relief on lifetime gifts',
    tags: 'taper relief seven year pet gift lifetime death misunderstanding',
    what: 'Taper relief reduces the TAX on a failed potentially exempt transfer made between 3 and 7 years before death. It does not reduce the value of the gift, and it does nothing at all where the gift falls within the nil rate band.',
    detail: [
      'This is the most commonly misunderstood relief in the code. A £200,000 gift made 5 years before death, with the nil rate band otherwise unused, attracts no tax — so there is no tax for taper to reduce, and the "60% relief" is worth nothing.',
      'The gift still uses the nil rate band first, which is where the real cost falls.',
    ],
    judgement: 'Taper is routinely presented as a reason to make gifts early. It is a reason, but not for the stated arithmetic — the seven-year clock on the nil rate band matters far more than the taper percentages.',
    cites: [['IHTA 1984 s.7(4)', 'Taper.'], ['IHTM14611', 'HMRC on how taper applies to the tax, not the transfer.']],
  },
  {
    id: 'bpr', t: 'Business and agricultural property relief',
    tags: 'bpr apr business agricultural relief excepted assets allowance',
    what: 'BPR and APR relieve qualifying business and agricultural property at 100% or 50%. From April 2026 the 100% rate is capped by an allowance, with the excess relieved at 50%.',
    detail: [
      'Excepted assets — assets not used wholly or mainly for the business and not required for future business use — are stripped out of the relieved value proportionately.',
      'Two years’ ownership is required, with replacement property rules.',
    ],
    judgement: 'The allowance itself is unresolved in the published guidance. Two GOV.UK policy papers describe a £1m allowance that is NOT transferable between spouses; IHTM25520 describes a £2.5m transferable figure. These cannot both be right, and the difference is worth up to £300,000 of tax on a second death. Do not rely on either until Finance Act 2026 Sch 12 has been read directly. The portal records this as an open point rather than picking a number.',
    cites: [
      ['IHTA 1984 s.105', 'Relevant business property.'],
      ['IHTA 1984 s.106', 'Two-year ownership.'],
      ['IHTA 1984 s.112', 'Excepted assets.'],
      ['IHTM25520', 'Conflicts with the policy papers — see above.'],
    ],
  },
  {
    id: 'normal-exp', t: 'Normal expenditure out of income',
    tags: 'normal expenditure income exemption gifts regular surplus evidence habitual',
    what: 'Gifts made as part of normal expenditure out of income are exempt without limit and without a seven-year clock, provided they are habitual, made out of income rather than capital, and leave you able to maintain your usual standard of living.',
    detail: [
      'The claim is made on IHT403 AFTER death, by your executors, from records kept contemporaneously. That is the whole difficulty: nobody is left to explain the pattern.',
      'A year-by-year schedule of net income, usual expenditure and gifts made is the evidence. It cannot be reconstructed later.',
    ],
    cites: [['IHTA 1984 s.21', 'The exemption.'], ['IHT403', 'The claim form.']],
  },
  {
    id: 'pensions-iht', t: 'Pensions coming into the estate',
    tags: 'pension unused funds death benefits estate change 2027',
    what: 'Unused pension funds and death benefits come into the estate for inheritance tax for deaths on or after 6 April 2027.',
    detail: [
      'This reverses the position that made pensions the most efficient asset to leave untouched, and it changes the order in which assets should be drawn down in retirement.',
      'The rule is held as a dated one rather than a boolean, so a projection for a death before that date still computes on the old basis.',
    ],
    cites: [['Autumn Budget 2024', 'Announced.'], ['Finance Act 2025', 'Legislation.']],
  },

  // --- Companies House -----------------------------------------------------
  {
    id: 'confirmation', t: 'The confirmation statement',
    tags: 'confirmation statement companies house days dormant strike criminal review',
    what: 'A confirmation statement is due each year within 14 days of the end of the review period. It is required regardless of dormancy.',
    detail: [
      'Missing it is a criminal offence and the most common trigger for compulsory strike-off. It is the cheapest filing to make and the most expensive to forget.',
      'It confirms the information on the register; it is not a set of accounts and carries no figures.',
    ],
    cites: [['CA 2006 s.853A', 'Duty to deliver.']],
  },
  {
    id: 'dormant-accounts', t: 'Dormant company filings',
    tags: 'dormant accounts companies house nine months',
    what: 'A dormant company files dormant accounts (AA02) at Companies House within 9 months of the period end, and a confirmation statement each year. No CT600 is due unless HMRC has issued a notice to file.',
    detail: [
      'Companies Act dormancy and the Corporation Tax trade-or-business test are different tests. A company can be dormant for filing purposes and still count for association, or the reverse.',
    ],
    cites: [['CA 2006 s.442', 'Accounts filing period.'], ['CA 2006 s.1169', 'Dormant.']],
  },
];

/**
 * Topics whose content depends on the rate tables are written as functions so
 * the explanation is generated from the same constants the engine computes
 * with. A stale sentence in a knowledge base is worse than no sentence.
 *
 * A year with no rate table throws inside those functions; that is caught here
 * and reported, rather than taking down the answer.
 */
export function kbField(topic: Topic, f: 'what', year?: TaxYear): string;
export function kbField(topic: Topic, f: 'detail', year?: TaxYear): string[];
export function kbField(topic: Topic, f: 'what' | 'detail', year?: TaxYear): string | string[] {
  const v = topic[f];
  const y = year ?? taxYearOf(new Date());
  try {
    const out = typeof v === 'function' ? (v as (y: TaxYear) => string | string[])(y) : v;
    return out ?? (f === 'detail' ? [] : '');
  } catch (e) {
    // A year the tables do not cover. Said plainly, never substituted.
    const msg = `The portal holds no rate table for ${y}, so these figures are not stated. (${(e as Error).message})`;
    return f === 'detail' ? [msg] : msg;
  }
}

export const kbById = (id: string): Topic | null => KB.find((k) => k.id === id) ?? null;

/**
 * Does this topic's content change with the tax year? True wherever the text
 * is generated from the rate tables rather than written out, which is exactly
 * the set of topics where naming a year has to change the answer.
 */
export const isYearSensitive = (t: Topic): boolean =>
  typeof t.what === 'function' || typeof t.detail === 'function';
