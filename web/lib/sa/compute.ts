/**
 * From SA boxes to a tax computation.
 *
 * Two things happen here, and they are deliberately separate:
 *
 *   pageResult()  — what ONE page adds up to, in that page's own terms. This is
 *                   what sits beside the boxes you are typing into, so it shows
 *                   the page's own arithmetic, names the boxes it used, and
 *                   says which of the page's own totals it disagrees with.
 *   saReturn()    — what the WHOLE return comes to. Every page feeds one of the
 *                   income categories the income tax engine already knows.
 *
 * Where the portal cannot do a box justice it says so and leaves the figure
 * out of the computation. It never carries a number into the tax it does not
 * know how to treat: an understated liability that looks confident is worse
 * than a stated gap. Every such gap appears in `warnings`.
 */

import { computeIncomeTax, type IncomeInputs, type IncomeTaxResult } from '@/lib/tax/income-tax';
import { computeSelfEmployedNic, type SelfEmployedNicResult } from '@/lib/tax/self-employed-nic';
import type { TaxYear } from '@/lib/tax/rates';
import { saBox, saKey, saPage } from './forms';

/** What the screen holds: box key to whatever was typed. */
export type SaValues = Record<string, string | number | boolean | null | undefined>;

const BASIC = 0.2;
const r2 = (x: number) => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------
// Reading boxes
// ---------------------------------------------------------------------------

/** A reader bound to one page, so a mapping reads `s('Business income', '9')`. */
function reader(v: SaValues, page: string) {
  /**
   * A mistyped section name would slug to a key no box has, and the mapping
   * would silently read zero — a wrong tax figure with nothing to show for it.
   * So resolve every reference against the schema and fail loudly instead.
   */
  const at = (section: string, box: string): string => {
    const key = saKey(page, section, box);
    if (!saBox(key)) throw new Error(`No such SA box: ${page} "${section}" box ${box}`);
    return key;
  };
  const num = (section: string, box: string): number => {
    const raw = v[at(section, box)];
    if (raw === undefined || raw === null || raw === '' || typeof raw === 'boolean') return 0;
    const x = Number(String(raw).replace(/[£,\s]/g, ''));
    return Number.isFinite(x) ? x : 0;
  };
  const sum = (section: string, ...boxes: string[]) =>
    boxes.reduce((t, b) => t + num(section, b), 0);
  const tick = (section: string, box: string): boolean => {
    const raw = v[at(section, box)];
    if (typeof raw === 'boolean') return raw;
    return typeof raw === 'string' && /^(x|y|yes|true|1)$/i.test(raw.trim());
  };
  /** True if anything at all has been typed on this page. */
  const used = () => {
    const p = saPage(page);
    if (!p) return false;
    return p.sections.some((s) => s.boxes.some((b) => {
      const raw = v[b.key];
      return raw !== undefined && raw !== null && raw !== '' && raw !== false;
    }));
  };
  return { num, sum, tick, used };
}

// ---------------------------------------------------------------------------
// One page's own arithmetic
// ---------------------------------------------------------------------------

export interface SaLine {
  label: string;
  value: number;
  /** The boxes this line was built from, e.g. "boxes 9 + 10 − 20". */
  from?: string;
  note?: string;
}

export interface SaPageResult {
  code: string;
  title: string;
  lines: SaLine[];
  /** One sentence saying where this page lands in the return. */
  feeds: string;
  warnings: string[];
  /** True when nothing has been entered on the page yet. */
  empty: boolean;
}

/**
 * Where a page prints its own total AND the portal can derive it, compare the
 * two. A silent difference between a typed total and the boxes above it is
 * exactly the error a paper return hides.
 */
function checkTotal(
  lines: SaLine[], warnings: string[],
  label: string, entered: number, derived: number, boxRef: string,
) {
  if (entered === 0) {
    lines.push({ label, value: r2(derived), from: `derived, ${boxRef} is blank` });
    return r2(derived);
  }
  lines.push({ label, value: r2(entered), from: boxRef });
  if (Math.abs(entered - derived) >= 1) {
    warnings.push(
      `${boxRef} says ${money(entered)} but the boxes above it come to ${money(derived)}, a difference of ${money(Math.abs(entered - derived))}. ` +
      `The entered figure is the one used. Check which is right before filing.`,
    );
  }
  return r2(entered);
}

const money = (x: number) =>
  '£' + Math.abs(x).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function pageResult(code: string, v: SaValues): SaPageResult {
  const page = saPage(code);
  const r = reader(v, code);
  const lines: SaLine[] = [];
  const warnings: string[] = [];
  let feeds = 'This page does not feed the income tax computation.';

  switch (code) {
    case 'SA100': {
      const S = 'Dividends and interest from UK banks and building societies';
      const netTaxed = r.num(S, '1');
      const grossTaxed = netTaxed / (1 - BASIC);
      const savings = grossTaxed + r.sum(S, '2', '3');
      lines.push({ label: 'Savings interest', value: r2(savings), from: 'boxes 1 (grossed) + 2 + 3' });
      if (netTaxed > 0) {
        lines.push({ label: 'Tax credit on taxed interest', value: r2(grossTaxed - netTaxed), from: 'box 1 × 20/80' });
        warnings.push('Box 1 is a NET figure. It is grossed up at 20% and the tax treated as already paid. Banks stopped deducting tax in April 2016, so this box is usually blank.');
      }
      const dividends = r.sum(S, '4', '5', '6');
      lines.push({ label: 'Dividends', value: r2(dividends), from: 'boxes 4 + 5 + 6' });

      const P = 'UK pensions, annuities and other state benefits received';
      const pension = r.sum(P, '8', '11', '13', '15', '16');
      lines.push({ label: 'Pensions and taxable benefits', value: r2(pension), from: 'boxes 8 + 11 + 13 + 15 + 16' });
      if (r.num(P, '9') > 0) {
        warnings.push('The State Pension lump sum in box 9 is NOT added to income. It is taxed at the highest rate applying to your other income, and the portal does not compute that charge yet.');
      }
      lines.push({ label: 'Tax taken off pensions and benefits', value: r2(r.sum(P, '10', '12', '14') + r.num(S, '7')), from: 'boxes 10 + 12 + 14, plus box 7' });

      const O = 'Other UK income not included on supplementary pages';
      const other = r.num(O, '17') - r.num(O, '18') + r.num(O, '20');
      lines.push({ label: 'Other UK income, net of expenses', value: r2(other), from: 'box 17 − box 18 + box 20' });

      const PEN = 'Paying into registered pension schemes and overseas pension schemes';
      const pen = r.sum(PEN, '1', '2', '3', '4');
      lines.push({ label: 'Gross pension contributions', value: r2(pen), from: 'boxes 1 + 2 + 3 + 4', note: 'Box 1.1 is a subset of box 1 and is not added again.' });

      const G = 'Charitable giving';
      const giftNet = r.num(G, '5') + r.num(G, '8') - r.num(G, '7');
      lines.push({ label: 'Gift Aid, grossed up', value: r2(giftNet / (1 - BASIC)), from: '(box 5 + box 8 − box 7) × 100/80' });
      if (r.sum(G, '9', '10') > 0) {
        warnings.push('Gifts of shares, securities, land or buildings (boxes 9 and 10) are a deduction from total income, not Gift Aid. The portal does not apply them yet.');
      }

      const H = 'High Income Child Benefit Charge';
      if (r.num(H, '1') > 0) {
        warnings.push(`Child Benefit of ${money(r.num(H, '1'))} is entered. The High Income Child Benefit Charge is not in the computation yet — check it separately against adjusted net income.`);
      }
      const W = 'Winter Fuel Payment and Pension Age Winter Heating Payment charge';
      if (r.num(W, '1') > 0) {
        warnings.push('The Winter Fuel Payment charge is not computed yet.');
      }
      feeds = 'Savings, dividends, pension income and other income, plus the pension and Gift Aid reliefs that reduce adjusted net income.';
      break;
    }

    case 'SA102': {
      const E = 'Employment';
      const B = 'Benefits from your employment';
      const X = 'Employment expenses';
      const pay = r.sum(E, '1', '3');
      const benefits = r.sum(B, '9', '10', '11', '12', '13', '14', '15', '16');
      const expenses = r.sum(X, '17', '18', '19', '20');
      lines.push({ label: 'Pay and tips', value: r2(pay), from: 'boxes 1 + 3', note: 'Box 1.1 is payrolled benefits already inside box 1 and is not added again.' });
      lines.push({ label: 'Benefits in kind', value: r2(benefits), from: 'boxes 9 to 16' });
      lines.push({ label: 'Allowable expenses', value: -r2(expenses), from: 'boxes 17 to 20' });
      lines.push({ label: 'Employment income', value: r2(pay + benefits - expenses) });
      lines.push({ label: 'PAYE tax taken off', value: r2(r.num(E, '2')), from: 'box 2' });
      if (r.tick(E, '7')) {
        warnings.push('This is a close company. Dividends in box 7.3 are declared here for information — enter them on the main return, boxes 4 or 5, so they are taxed.');
      }
      warnings.push('The portal holds ONE employment. HMRC needs a separate SA102 for each; a second employment is not in this computation.');
      feeds = 'Employment income, and PAYE tax already paid.';
      break;
    }

    case 'SA103S': {
      const I = 'Business income';
      const X = 'Allowable business expenses';
      const N = 'Net profit or loss';
      const C = 'Capital allowances';
      const K = 'Calculating your taxable profit or loss';
      const T = 'Total taxable profits or net business loss';
      const L = 'Losses, Class 2 and Class 4 NICs and CIS deductions';

      const turnover = r.sum(I, '9', '10');
      const allowance = r.num(I, '10.1');
      lines.push({ label: 'Turnover', value: r2(turnover), from: 'boxes 9 + 10' });

      let netProfit: number;
      if (allowance > 0) {
        netProfit = Math.max(0, turnover - allowance);
        lines.push({ label: 'Trading income allowance', value: -r2(allowance), from: 'box 10.1' });
        warnings.push('The trading income allowance is claimed, so expenses and capital allowances are ignored. It cannot be claimed at the same time as expenses.');
      } else {
        const expenses = r.num(X, '20') || r.sum(X, '11', '12', '13', '14', '15', '16', '17', '18', '19');
        lines.push({ label: 'Allowable expenses', value: -r2(expenses), from: r.num(X, '20') ? 'box 20' : 'boxes 11 to 19' });
        netProfit = checkTotal(lines, warnings, 'Net profit', r.num(N, '21') - r.num(N, '22'), turnover - expenses, 'box 21/22');
        const capitalAllowances = r.sum(C, '23', '24', '24.1', '25', '25.1', '25.2');
        if (capitalAllowances) lines.push({ label: 'Capital allowances', value: -r2(capitalAllowances), from: 'boxes 23 to 25.2' });
        const additions = r.num(C, '26') + r.num(K, '27');
        if (additions) lines.push({ label: 'Balancing charges and own use', value: r2(additions), from: 'boxes 26 + 27' });
        netProfit = checkTotal(lines, warnings, 'Net business profit for tax purposes',
          r.num(K, '28'), netProfit - capitalAllowances + additions, 'box 28');
      }

      const taxable = checkTotal(lines, warnings, 'Taxable profit',
        r.num(T, '31'), netProfit - r.num(K, '29') + r.num(K, '30'), 'box 31');
      lines.push({ label: 'CIS deductions', value: r2(r.num(L, '38')), from: 'box 38' });
      if (r.tick(L, '36') && taxable >= 0) {
        warnings.push('Box 36 pays Class 2 voluntarily. It only does anything if profits are below the Small Profits Threshold — above it the year is already credited.');
      }
      if (r.num(T, '32') > 0) {
        warnings.push('A loss is entered. Loss relief claims are recorded but not applied to the computation.');
      }
      feeds = 'Self-employment profit, and CIS deductions as tax already paid. Class 2 and Class 4 are charged on this year\'s trading profits as a whole, so they are shown in the return on the left rather than here.';
      break;
    }

    case 'SA103F': {
      const I = 'Business income';
      const X = 'Business expenses';
      const K = 'Calculating your taxable profit or loss';
      const L = 'Losses';
      const D = 'CIS deductions and tax taken off';
      const turnover = r.sum(I, '15', '16');
      const expenses = r.num(X, '31') || 0;
      lines.push({ label: 'Turnover', value: r2(turnover), from: 'boxes 15 + 16' });
      lines.push({ label: 'Total expenses', value: -r2(expenses), from: 'box 31' });
      const disallowed = r.num('Disallowable expenses', '46');
      if (disallowed) lines.push({ label: 'Disallowable expenses added back', value: r2(disallowed), from: 'box 46' });
      const taxable = checkTotal(lines, warnings, 'Taxable profit',
        r.num(K, '76'), r.num(K, '64') - r.num(K, '74') + r.num(K, '75'), 'box 76');
      lines.push({ label: 'CIS deductions and other tax taken off', value: r2(r.sum(D, '81', '82')), from: 'boxes 81 + 82' });
      if (r.num(L, '77') > 0) warnings.push('A loss is entered. Loss relief claims are recorded but not applied.');
      warnings.push('The full page is recorded box for box, but only boxes 64, 74, 75 and 76 drive the computation. The expenses analysis and balance sheet are held for the return, not recomputed.');
      feeds = 'Self-employment profit, and tax already paid. Class 2 and Class 4 are charged on this year\'s trading profits as a whole, so they are shown in the return on the left.';
      break;
    }

    case 'SA105': {
      const D = 'UK property details';
      const I = 'Property income';
      const X = 'Property expenses';
      const K = 'Calculating your taxable profit or loss';
      const F = 'Residential property finance costs';
      const income = r.sum(I, '20', '22', '23');
      lines.push({ label: 'Rents and other property income', value: r2(income), from: 'boxes 20 + 22 + 23' });
      const allowance = r.num(I, '20.1');
      let adjusted: number;
      if (allowance > 0) {
        adjusted = Math.max(0, income - allowance);
        lines.push({ label: 'Property income allowance', value: -r2(allowance), from: 'box 20.1' });
        warnings.push('The property income allowance is claimed, so expenses and capital allowances are ignored.');
      } else {
        const expenses = r.sum(X, '24', '25', '26', '27', '28', '29');
        const capital = r.sum(K, '32', '33', '33.1', '33.2', '34.1', '35', '36') + r.num(K, '37');
        const additions = r.sum(K, '30', '31');
        lines.push({ label: 'Allowable expenses', value: -r2(expenses), from: 'boxes 24 to 29' });
        if (additions) lines.push({ label: 'Private use adjustment and balancing charges', value: r2(additions), from: 'boxes 30 + 31' });
        if (capital) lines.push({ label: 'Capital allowances and Rent a Room exempt amount', value: -r2(capital), from: 'boxes 32 to 37' });
        adjusted = checkTotal(lines, warnings, 'Adjusted profit',
          r.num(K, '38'), income - expenses + additions - capital, 'box 38');
      }
      const taxable = checkTotal(lines, warnings, 'Taxable profit',
        r.num(K, '40'), adjusted - r.num(K, '39'), 'box 40');
      void taxable;
      const finance = r.sum(F, '44', '45');
      lines.push({ label: 'Residential finance costs', value: r2(finance), from: 'boxes 44 + 45',
        note: 'Relieved as a 20% reducer against the tax, not deducted from the profit.' });
      lines.push({ label: 'Tax taken off property income', value: r2(r.num(I, '21')), from: 'box 21' });
      if (r.tick(D, '3')) {
        warnings.push('Income from jointly let property is declared. Enter only YOUR share in these boxes — the portal does not apportion them.');
      }
      warnings.push('This page and the Properties tab are separate records. If the same letting is in both, the portal will count it twice — use one or the other.');
      feeds = 'Property profit, and residential finance costs as a basic rate reducer.';
      break;
    }

    case 'SA104S': case 'SA104F': {
      const T = code === 'SA104S'
        ? 'Your share of the partnership’s trading or professional profits'
        : 'Your share of the partnership’s trading or professional profits';
      const profit = r.num(T, '20');
      lines.push({ label: 'Share of taxable partnership profits', value: r2(profit), from: 'box 20' });
      if (code === 'SA104S') {
        lines.push({ label: 'Share of untaxed interest', value: r2(r.num('Your share of the partnership’s untaxed income', '28')), from: 'box 28' });
        lines.push({ label: 'Share of tax and CIS deductions', value: r2(r.sum('Your share of the partnership’s tax paid and deductions', '30', '31')), from: 'boxes 30 + 31' });
      } else {
        lines.push({ label: 'Share of untaxed savings income', value: r2(r.num('Untaxed savings income', '35')), from: 'box 35' });
        lines.push({ label: 'Share of UK property profit', value: r2(r.num('Income from UK property', '41')), from: 'box 41' });
        lines.push({ label: 'Share of dividend income', value: r2(r.num('Your share of the partnership’s taxed income and dividend income', '70')), from: 'box 70' });
        lines.push({ label: 'Share of other untaxed income', value: r2(r.num('Other untaxed UK income', '48') + r.num('Other untaxed foreign income', '60')), from: 'boxes 48 + 60' });
        lines.push({ label: 'Share of tax taken off', value: r2(r.num('Your share of the partnership’s tax paid and deductions', '80')), from: 'box 80' });
        warnings.push('Box 76 (total taxed and untaxed income other than that taxable at 10% and 20%) is NOT carried in — it overlaps the boxes above and would double count.');
      }
      feeds = 'Partnership profit as self-employment income, and into Class 2 and Class 4, with the savings, property and dividend shares in their own categories.';
      break;
    }

    case 'SA106': {
      lines.push({ label: 'Foreign savings interest', value: r2(r.num('Interest and other income from overseas savings', '4')), from: 'box 4' });
      lines.push({ label: 'Foreign dividends', value: r2(r.num('Dividends from foreign companies', '6')), from: 'box 6' });
      lines.push({ label: 'Overseas pensions, benefits and royalties', value: r2(r.num('Overseas pensions, social security benefits and royalties', '9')), from: 'box 9' });
      lines.push({ label: 'Other foreign income', value: r2(r.num('Dividend income received by a person abroad', '11')
        + r.num('All other income received by a person abroad and any remitted ring fenced foreign income', '13')), from: 'boxes 11 + 13' });
      lines.push({ label: 'Overseas property profit', value: r2(r.num('Summary of income from land and property abroad', '27')), from: 'box 27' });
      warnings.push('Foreign Tax Credit Relief is NOT computed. The foreign tax in boxes 3, 5, 8, 10, 12 and 28 is recorded but does not reduce the liability here.');
      warnings.push('Amounts claimed under the FIG regime are recorded but not deducted. If you are claiming FIG, the computation overstates the income.');
      feeds = 'Foreign savings, dividends, pension and property income, gross of foreign tax.';
      break;
    }

    case 'SA107': {
      const disc = r.sum('Discretionary income payment from a UK resident trust', '1', '2');
      const nonDisc = r.sum('Non-discretionary income entitlement from a trust', '3', '4', '5');
      const estates = r.sum('Income from the estates of deceased persons', '16', '17', '18', '18.1', '19');
      lines.push({ label: 'Discretionary trust payments, net', value: r2(disc), from: 'boxes 1 + 2' });
      lines.push({ label: 'Non-discretionary trust income, net', value: r2(nonDisc), from: 'boxes 3 + 4 + 5' });
      lines.push({ label: 'Estate income, net', value: r2(estates), from: 'boxes 16 to 19' });
      lines.push({ label: 'Residential finance costs from trusts and estates', value: r2(r.sum('Residential property finance costs', '25', '25.1')), from: 'boxes 25 + 25.1' });
      if (disc + nonDisc + estates > 0) {
        warnings.push('SA107 figures are NOT carried into the computation. Each box is a NET amount with its own grossing rate and its own tax credit — 45% on discretionary payments, 20% or the dividend rate elsewhere — and getting that wrong silently is worse than leaving it out. Treat this page as a record until the grossing is built.');
      }
      feeds = 'Recorded only. Nothing from this page enters the computation yet.';
      break;
    }

    case 'SA108': {
      const gains = r.num('Residential property and carried interest', '6')
        + r.num('Cryptoassets', '13.4')
        + r.num('Other property, assets and gains', '17')
        + r.num('Listed shares and securities', '26')
        + r.num('Unlisted shares and securities', '34');
      const losses = r.num('Residential property and carried interest', '7')
        + r.num('Cryptoassets', '13.5')
        + r.num('Other property, assets and gains', '19')
        + r.num('Listed shares and securities', '27')
        + r.num('Unlisted shares and securities', '35');
      lines.push({ label: 'Gains in the year, before losses', value: r2(gains), from: 'boxes 6 + 13.4 + 17 + 26 + 34' });
      lines.push({ label: 'Losses in the year', value: -r2(losses), from: 'boxes 7 + 13.5 + 19 + 27 + 35' });
      lines.push({ label: 'Losses brought forward and used', value: -r2(r.num('Losses set against 2025–26 capital gains', '45')), from: 'box 45' });
      lines.push({ label: 'Net chargeable gains before the annual exempt amount', value: r2(gains - losses - r.num('Losses set against 2025–26 capital gains', '45')) });
      lines.push({ label: 'CGT already paid', value: r2(r.num('Residential property and carried interest', '10') + r.num('Residential property and carried interest', '12')), from: 'boxes 10 + 12' });
      warnings.push('There is NO box for the annual exempt amount — HMRC applies it in the calculation. The figure above is before it.');
      warnings.push('Capital gains tax is not part of the income tax computation. Gains affect it only through Business Asset Disposal Relief and the rate band, which the CGT screen handles.');
      feeds = 'Capital gains are computed on their own screen. Nothing here enters the income tax figure.';
      break;
    }

    case 'SA101': {
      const gilts = r.num('Interest from gilt-edged and other UK securities', '3')
        || r.sum('Interest from gilt-edged and other UK securities', '1', '2');
      lines.push({ label: 'Gilt and other UK securities interest, gross', value: r2(gilts), from: 'box 3, or boxes 1 + 2' });
      lines.push({ label: 'Tax taken off gilt interest', value: r2(r.num('Interest from gilt-edged and other UK securities', '2')), from: 'box 2' });
      const shareSchemes = r.sum('Share schemes and employment lump sums', '1', '3', '4', '5');
      lines.push({ label: 'Share schemes and employment lump sums', value: r2(shareSchemes), from: 'boxes 1 + 3 + 4 + 5' });
      lines.push({ label: 'Tax taken off lump sums', value: r2(r.num('Share schemes and employment lump sums', '6')), from: 'box 6' });
      const stock = r.sum('Stock dividends, bonus issues of securities and redeemable shares', '12', '13', '13.1');
      lines.push({ label: 'Stock dividends and loans written off', value: r2(stock), from: 'boxes 12 + 13 + 13.1' });
      const reliefs = r.sum('Other tax reliefs', '1', '2', '3', '10');
      if (reliefs > 0) {
        warnings.push(`Venture capital reliefs of ${money(reliefs)} are recorded. They are a REDUCER against the tax at 30% (or 50% for SEIS), not a deduction from income, and the portal does not apply them yet.`);
      }
      if (r.sum('Other tax reliefs', '4', '5', '6', '6.1', '7', '8', '9', '12') > 0) {
        warnings.push('Other reliefs on this page — qualifying loan interest, annual payments, maintenance, post-cessation relief — are recorded but not applied to the computation.');
      }
      const gains = r.sum('Gains from life insurance policies, capital redemption policies and life annuity contracts', '4', '6', '8');
      if (gains > 0) {
        warnings.push('Chargeable event gains are recorded but not computed. Top slicing relief is not implemented, and without it the liability on a gain is usually overstated.');
      }
      if (r.num('Pension savings tax charges', '10') > 0) {
        warnings.push('An annual allowance excess is entered. The annual allowance charge is not in the computation yet — Ivor can show the taper working if you need to check the allowance itself.');
      }
      feeds = 'Gilt interest as savings income, share scheme and lump sum income as employment income, and stock dividends as dividends.';
      break;
    }

    case 'SA109': {
      const R = 'Residence status';
      if (r.tick(R, '1')) warnings.push('Non-resident for the year. The portal computes on the ordinary resident basis and does not restrict the charge or the personal allowance.');
      if (r.tick(R, '3')) warnings.push('Split year treatment is claimed. The computation covers the whole year and does not split it.');
      if (r.tick('Foreign income and gains (FIG) regime', '28') || r.tick('Foreign income and gains (FIG) regime', '29')) {
        warnings.push('A FIG regime claim is made. Relieved foreign income and gains are still in the computation, so the liability shown is too high.');
      }
      lines.push({ label: 'Days in the UK', value: r.num(R, '10'), from: 'box 10' });
      lines.push({ label: 'UK ties', value: r.num(R, '12'), from: 'box 12' });
      feeds = 'Residence status changes how everything else is taxed. The portal records it but computes on the resident basis.';
      break;
    }
  }

  return {
    code,
    title: page?.title ?? code,
    lines,
    feeds,
    warnings,
    empty: !r.used(),
  };
}

// ---------------------------------------------------------------------------
// The whole return
// ---------------------------------------------------------------------------

export interface SaReturn {
  taxYear: TaxYear;
  income: IncomeInputs;
  /** Tax already paid — PAYE, CIS, tax deducted at source, tax credits. */
  taxDeducted: number;
  tax: IncomeTaxResult | null;
  /** Class 2 and Class 4, or null where the year has no table for them. */
  nic: SelfEmployedNicResult | null;
  /** Income tax plus Class 2 and Class 4. */
  totalDue: number;
  /** Total due less tax already paid. Positive means owed. */
  balance: number;
  /** Which pages have something on them. */
  pagesUsed: string[];
  warnings: string[];
}

export function saReturn(v: SaValues, taxYear: TaxYear): SaReturn {
  const w = (code: string) => reader(v, code);
  const a = w('SA100'), b = w('SA101'), e = w('SA102');
  const s = w('SA103S'), f = w('SA103F');
  const ps = w('SA104S'), pf = w('SA104F');
  const p = w('SA105'), fo = w('SA106');

  // --- employment ----------------------------------------------------------
  const employment =
    e.sum('Employment', '1', '3')
    + e.sum('Benefits from your employment', '9', '10', '11', '12', '13', '14', '15', '16')
    - e.sum('Employment expenses', '17', '18', '19', '20')
    + b.sum('Share schemes and employment lump sums', '1', '3', '4', '5');

  // --- trade ---------------------------------------------------------------
  const sesTurnover = s.sum('Business income', '9', '10');
  const sesAllowance = s.num('Business income', '10.1');
  const sesFallback = sesAllowance > 0
    ? Math.max(0, sesTurnover - sesAllowance)
    : s.num('Calculating your taxable profit or loss', '28')
      - s.num('Calculating your taxable profit or loss', '29')
      + s.num('Calculating your taxable profit or loss', '30');
  const selfEmployment =
    (s.num('Total taxable profits or net business loss', '31') || sesFallback)
    + (f.num('Calculating your taxable profit or loss', '76')
      || (f.num('Calculating your taxable profit or loss', '64')
        - f.num('Calculating your taxable profit or loss', '74')
        + f.num('Calculating your taxable profit or loss', '75')))
    + ps.num('Your share of the partnership’s trading or professional profits', '20')
    + pf.num('Your share of the partnership’s trading or professional profits', '20');

  // --- property ------------------------------------------------------------
  const propIncome = p.sum('Property income', '20', '22', '23');
  const propAllowance = p.num('Property income', '20.1');
  const propFallback = propAllowance > 0
    ? Math.max(0, propIncome - propAllowance)
    : p.num('Calculating your taxable profit or loss', '38')
      - p.num('Calculating your taxable profit or loss', '39');
  const property =
    (p.num('Calculating your taxable profit or loss', '40') || propFallback)
    + pf.num('Income from UK property', '41')
    + fo.num('Summary of income from land and property abroad', '27');
  const propertyFinanceCosts =
    p.sum('Residential property finance costs', '44', '45')
    + pf.sum('Income from UK property', '41.1', '41.2');

  // --- savings -------------------------------------------------------------
  const netTaxedInterest = a.num('Dividends and interest from UK banks and building societies', '1');
  const grossedTaxedInterest = netTaxedInterest / (1 - BASIC);
  const savings =
    grossedTaxedInterest
    + a.sum('Dividends and interest from UK banks and building societies', '2', '3')
    + (b.num('Interest from gilt-edged and other UK securities', '3')
      || b.sum('Interest from gilt-edged and other UK securities', '1', '2'))
    + ps.num('Your share of the partnership’s untaxed income', '28')
    + pf.num('Untaxed savings income', '35')
    + fo.num('Interest and other income from overseas savings', '4');

  // --- dividends -----------------------------------------------------------
  const dividends =
    a.sum('Dividends and interest from UK banks and building societies', '4', '5', '6')
    + b.sum('Stock dividends, bonus issues of securities and redeemable shares', '12', '13', '13.1')
    + pf.num('Your share of the partnership’s taxed income and dividend income', '70')
    + fo.num('Dividends from foreign companies', '6');

  // --- pensions ------------------------------------------------------------
  const pension =
    a.sum('UK pensions, annuities and other state benefits received', '8', '11', '13', '15', '16')
    + fo.num('Overseas pensions, social security benefits and royalties', '9');

  // --- other non-savings ---------------------------------------------------
  const other =
    a.num('Other UK income not included on supplementary pages', '17')
    - a.num('Other UK income not included on supplementary pages', '18')
    + a.num('Other UK income not included on supplementary pages', '20')
    + pf.num('Other untaxed UK income', '48')
    + pf.num('Other untaxed foreign income', '60')
    + fo.num('Dividend income received by a person abroad', '11')
    + fo.num('All other income received by a person abroad and any remitted ring fenced foreign income', '13');

  // --- reliefs -------------------------------------------------------------
  const grossPensionContributions =
    a.sum('Paying into registered pension schemes and overseas pension schemes', '1', '2', '3', '4');
  const giftAidNet =
    a.num('Charitable giving', '5') + a.num('Charitable giving', '8') - a.num('Charitable giving', '7');
  const giftAidGross = giftAidNet / (1 - BASIC);

  // --- tax already paid ----------------------------------------------------
  const taxDeducted = r2(
    e.num('Employment', '2')
    + (grossedTaxedInterest - netTaxedInterest)
    + a.sum('Dividends and interest from UK banks and building societies', '7')
    + a.sum('UK pensions, annuities and other state benefits received', '10', '12', '14')
    + a.num('Other UK income not included on supplementary pages', '19')
    + b.num('Interest from gilt-edged and other UK securities', '2')
    + b.num('Share schemes and employment lump sums', '6')
    + s.num('Losses, Class 2 and Class 4 NICs and CIS deductions', '38')
    + f.sum('CIS deductions and tax taken off', '81', '82')
    + ps.sum('Your share of the partnership’s tax paid and deductions', '30', '31')
    + pf.num('Your share of the partnership’s tax paid and deductions', '80')
    + p.num('Property income', '21'),
  );

  const income: IncomeInputs = {
    employment: r2(employment),
    selfEmployment: r2(selfEmployment),
    property: r2(property),
    propertyFinanceCosts: r2(propertyFinanceCosts),
    pension: r2(pension),
    other: r2(other),
    savings: r2(savings),
    dividends: r2(dividends),
    grossPensionContributions: r2(grossPensionContributions),
    giftAidGross: r2(giftAidGross),
  };

  const warnings: string[] = [];
  const pagesUsed: string[] = [];
  for (const page of ['SA100', 'SA101', 'SA102', 'SA103S', 'SA103F', 'SA104S', 'SA104F', 'SA105', 'SA106', 'SA107', 'SA108', 'SA109']) {
    if (reader(v, page).used()) pagesUsed.push(page);
  }

  let tax: IncomeTaxResult | null = null;
  try {
    tax = computeIncomeTax(income, taxYear);
  } catch (err) {
    warnings.push(String((err as Error).message));
  }

  // --- Class 2 and Class 4 -------------------------------------------------
  // Charged on the WHOLE of the year's self-employment and partnership
  // profits, not trade by trade, so the boxes are gathered across all four
  // trade pages before anything is computed.
  const anyTick = (...t: boolean[]) => t.some(Boolean);
  let nic: SelfEmployedNicResult | null = null;
  const runsATrade = selfEmployment > 0
    || anyTick(
      s.tick('Losses, Class 2 and Class 4 NICs and CIS deductions', '36'),
      f.tick('Class 2 and Class 4 National Insurance contributions', '100'),
      ps.tick('Class 2 and Class 4 National Insurance contributions', '25'),
      pf.tick('Class 2 and Class 4 National Insurance contributions', '25'),
    );
  if (runsATrade) {
    try {
      nic = computeSelfEmployedNic({
        profits: selfEmployment,
        payClass2Voluntarily: anyTick(
          s.tick('Losses, Class 2 and Class 4 NICs and CIS deductions', '36'),
          f.tick('Class 2 and Class 4 National Insurance contributions', '100'),
          ps.tick('Class 2 and Class 4 National Insurance contributions', '25'),
          pf.tick('Class 2 and Class 4 National Insurance contributions', '25'),
        ),
        exemptFromClass4: anyTick(
          s.tick('Losses, Class 2 and Class 4 NICs and CIS deductions', '37'),
          f.tick('Class 2 and Class 4 National Insurance contributions', '101'),
          ps.tick('Class 2 and Class 4 National Insurance contributions', '26'),
          pf.tick('Class 2 and Class 4 National Insurance contributions', '26'),
        ),
        class4Adjustment:
          f.num('Class 2 and Class 4 National Insurance contributions', '102')
          + ps.num('Class 2 and Class 4 National Insurance contributions', '27')
          + pf.num('Class 2 and Class 4 National Insurance contributions', '27'),
      }, taxYear);
    } catch (err) {
      warnings.push(`${(err as Error).message} — Class 2 and Class 4 are not in the figure below.`);
    }
  }

  // Gaps that matter for the whole return, gathered once rather than per page.
  if (pagesUsed.includes('SA107')) {
    warnings.push('SA107 trust and estate income is recorded but NOT taxed here.');
  }
  for (const note of nic?.notes ?? []) warnings.push(note);
  if (pagesUsed.includes('SA106')) {
    warnings.push('Foreign Tax Credit Relief is not applied, so foreign income is taxed twice in this figure.');
  }
  if (pagesUsed.includes('SA109')) {
    warnings.push('Residence, split year and FIG claims on SA109 are recorded but the computation runs on the ordinary resident, arising basis.');
  }
  if (tax && tax.personalAllowanceLost > 0) {
    warnings.push(`£${tax.personalAllowanceLost.toLocaleString('en-GB')} of personal allowance is lost to the taper. A further gross pension contribution recovers it at the marginal rate.`);
  }

  // Class 4 is inside the payments-on-account calculation; Class 2 is not.
  const totalDue = r2((tax?.totalTax ?? 0) + (nic?.class2 ?? 0) + (nic?.class4 ?? 0));
  const balance = r2(totalDue - taxDeducted);
  if (tax && balance >= 1000) {
    warnings.push('A balance of £1,000 or more sets payments on account for next year at half this each, due 31 January and 31 July — unless 80% or more of the tax was deducted at source. Class 4 counts towards them; Class 2 does not.');
  }

  return { taxYear, income, taxDeducted, tax, nic, totalDue, balance, pagesUsed, warnings };
}
