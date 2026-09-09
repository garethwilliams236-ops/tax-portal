/**
 * The Self Assessment return, box by box.
 *
 * Every box below carries HMRC's own number and wording, taken from the 2026
 * forms (tax year 2025-26) on GOV.UK and cross-checked against the published
 * notes. The point of holding the real box numbers is that a figure in the
 * portal can be reconciled against the paper return line by line — which is
 * only worth anything if the numbers are right, so nothing here is invented.
 *
 * Three things the 2025-26 forms changed that a stale mapping would get wrong:
 *
 *   SA105  Furnished holiday lettings is GONE. The regime was abolished from
 *          6 April 2025 and boxes 5 to 19 are printed "no longer in use".
 *   SA108  Was renumbered for 2024-25 after the October 2024 rate change. Any
 *          mapping carried forward from 2023-24 or earlier is wrong.
 *   SA109  Rewritten and retitled for the foreign income and gains regime. The
 *          remittance basis and domicile boxes are gone.
 *
 * Boxes marked `unverified` came back from research with a caveat — usually a
 * section heading that could not be pinned down, or a box the form and the
 * notes disagreed about. They are shown with a marker rather than silently
 * presented as certain.
 */

export type BoxKind = 'money' | 'number' | 'date' | 'text' | 'yesno';

export interface Box {
  /** HMRC's box number, exactly as printed. Not always an integer: "13.1", "5Q", "52EG". */
  box: string;
  label: string;
  kind: BoxKind;
  /** The key this box is stored under. Includes the section, because SA100 restarts numbering. */
  key: string;
  /** Research could not fully confirm this box's section or wording. */
  unverified?: boolean;
}

export interface Section { name: string; boxes: Box[] }

export interface Page {
  code: string;
  title: string;
  /** Who needs it, and anything about the page that would otherwise catch you out. */
  note: string;
  sections: Section[];
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/**
 * The spec is written in HMRC's own order, one line per box:
 *   PAGE | Section | Box | Label | kind
 * A trailing "|?" marks a box research could not fully confirm.
 */
function parse(spec: string): Page[] {
  const byPage = new Map<string, Map<string, Box[]>>();
  for (const raw of spec.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|').map((p) => p.trim());
    const [page, section, box, label, kind, flag] = parts;
    if (!page || !section || !box || !label || !kind) {
      throw new Error(`Malformed box spec: ${line}`);
    }
    if (!byPage.has(page)) byPage.set(page, new Map());
    const sections = byPage.get(page)!;
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push({
      box,
      label,
      kind: kind as BoxKind,
      key: `${page}.${slug(section)}.${box}`,
      ...(flag === '?' ? { unverified: true } : {}),
    });
  }
  return [...byPage.entries()].map(([code, sections]) => ({
    code,
    title: PAGE_TITLES[code] ?? code,
    note: PAGE_NOTES[code] ?? '',
    sections: [...sections.entries()].map(([name, boxes]) => ({ name, boxes })),
  }));
}

const PAGE_TITLES: Record<string, string> = {
  SA100: 'Main return',
  SA101: 'Additional information',
  SA102: 'Employment',
  SA103S: 'Self-employment (short)',
  SA103F: 'Self-employment (full)',
  SA104S: 'Partnership (short)',
  SA104F: 'Partnership (full)',
  SA105: 'UK property',
  SA106: 'Foreign',
  SA107: 'Trusts etc',
  SA108: 'Capital gains',
  SA109: 'Residence and FIG',
};

const PAGE_NOTES: Record<string, string> = {
  SA100: 'The core return. Box numbering RESTARTS at 1 in several sections on page TR 5, so a box number only identifies a box when paired with its section.',
  SA101: 'Less common income and reliefs. The lifetime allowance boxes are dead — the LTA went on 6 April 2024 — and there is no live SITR box.',
  SA102: 'One page per employment. The close company boxes (6.1, 7 to 7.4) are new for 2025-26.',
  SA103S: 'Turnover below £90,000. Boxes 11 to 19 may be left blank with a single total in box 20. The page ends at box 38: there is no "any other information" box.',
  SA103F: 'The full self-employment page, with the disallowable column and the balance sheet.',
  SA104S: 'Your share of a partnership, short version.',
  SA104F: 'Your share of a partnership, full version, including the partnership’s savings, property and dividend income.',
  SA105: 'Furnished holiday lettings NO LONGER EXISTS: the regime was abolished from 6 April 2025 and boxes 5 to 19 are printed "no longer in use". One set of boxes covers the whole UK property business; box 1 counts the properties.',
  SA106: 'Foreign income. The lettered boxes A to F are the COLUMNS of a per-country table — the portal holds one row per section, so a second country needs a second row added on the paper return. Boxes 14 to 24.2 are the overseas property business; 25 to 32 summarise it.',
  SA107: 'Income from trusts, settlements and the estates of deceased persons.',
  SA108: 'Renumbered for 2024-25 after the October 2024 rate change — a pre-2024-25 mapping is wrong. There is NO box for the annual exempt amount: HMRC applies it in the calculation.',
  SA109: 'Rewritten for 2025-26 around the foreign income and gains regime. The remittance basis and domicile boxes are gone.',
};

export const SPEC = String.raw`
# --- SA100 main return ------------------------------------------------------
SA100|Dividends and interest from UK banks and building societies|1|Taxed UK interest – the net amount after tax has been taken off|money
SA100|Dividends and interest from UK banks and building societies|2|Untaxed UK interest – amounts which have not had tax taken off|money
SA100|Dividends and interest from UK banks and building societies|3|Untaxed foreign interest (up to £2,000) – amounts which have not had tax taken off|money
SA100|Dividends and interest from UK banks and building societies|4|Dividends from UK companies – the amount received|money
SA100|Dividends and interest from UK banks and building societies|5|Other dividends – the amount received|money
SA100|Dividends and interest from UK banks and building societies|6|Foreign dividends (up to £500) – the amount in sterling after foreign tax was taken off|money
SA100|Dividends and interest from UK banks and building societies|7|Tax taken off foreign dividends – the sterling equivalent|money
SA100|UK pensions, annuities and other state benefits received|8|State Pension – amount you were entitled to receive in the year|money
SA100|UK pensions, annuities and other state benefits received|9|State Pension lump sum – the gross amount of any lump sum|money
SA100|UK pensions, annuities and other state benefits received|10|Tax taken off box 9|money
SA100|UK pensions, annuities and other state benefits received|11|Pensions (other than State Pension), retirement annuities and taxable lump sums treated as pensions – the gross amount|money
SA100|UK pensions, annuities and other state benefits received|12|Tax taken off box 11|money
SA100|UK pensions, annuities and other state benefits received|13|Taxable Incapacity Benefit and contribution-based Employment and Support Allowance|money
SA100|UK pensions, annuities and other state benefits received|14|Tax taken off Incapacity Benefit in box 13|money
SA100|UK pensions, annuities and other state benefits received|15|Jobseeker's Allowance|money
SA100|UK pensions, annuities and other state benefits received|16|Total of any other taxable State Pensions and benefits|money
SA100|Other UK income not included on supplementary pages|17|Other taxable income – before expenses and tax taken off|money
SA100|Other UK income not included on supplementary pages|18|Total amount of allowable expenses|money
SA100|Other UK income not included on supplementary pages|19|Any tax taken off box 17|money
SA100|Other UK income not included on supplementary pages|20|Benefit from pre-owned assets|money
SA100|Other UK income not included on supplementary pages|21|Description of income in boxes 17 and 20|text
SA100|Paying into registered pension schemes and overseas pension schemes|1|Payments to registered pension schemes where basic rate tax relief will be claimed by your pension provider (called 'relief at source')|money
SA100|Paying into registered pension schemes and overseas pension schemes|1.1|Total of any 'one-off' payments in box 1|money
SA100|Paying into registered pension schemes and overseas pension schemes|2|Payments to a retirement annuity contract where basic rate tax relief will not be claimed by your provider|money
SA100|Paying into registered pension schemes and overseas pension schemes|3|Payments to your employer's scheme which were not deducted from your pay before tax|money
SA100|Paying into registered pension schemes and overseas pension schemes|4|Payments to an overseas pension scheme, which is not UK-registered, which are eligible for tax relief|money
SA100|Charitable giving|5|Gift Aid payments made in the year to 5 April 2026|money
SA100|Charitable giving|6|Total of any 'one-off' payments in box 5|money
SA100|Charitable giving|7|Gift Aid payments made in the year to 5 April 2026 but treated as if made in the year to 5 April 2025|money
SA100|Charitable giving|8|Gift Aid payments made after 5 April 2026 but to be treated as if made in the year to 5 April 2026|money
SA100|Charitable giving|9|Value of qualifying shares or securities gifted to charity|money
SA100|Charitable giving|10|Value of qualifying land and buildings gifted to charity|money
SA100|Blind Person's Allowance|13|If you're registered blind, or severely sight impaired, and your name is on a local authority or other register, put 'X' in the box|yesno
SA100|Blind Person's Allowance|14|Enter the name of the local authority or other register|text
SA100|Blind Person's Allowance|15|If you want your spouse's, or civil partner's, surplus allowance, put 'X' in the box|yesno
SA100|Blind Person's Allowance|16|If you want your spouse, or civil partner, to have your surplus allowance, put 'X' in the box|yesno
SA100|Student Loan and Postgraduate Loan repayments|1|If you've received notification from the Student Loans Company that your repayment of an Income Contingent Student Loan began before 6 April 2026, put 'X' in the box|yesno
SA100|Student Loan and Postgraduate Loan repayments|2|If your employer has deducted Student Loan repayments enter the amount deducted|money
SA100|Student Loan and Postgraduate Loan repayments|3|If your employer has deducted Postgraduate Loan repayments enter the amount deducted|money
SA100|High Income Child Benefit Charge|1|Enter the total amount of Child Benefit you and your partner got for the year to 5 April 2026|money
SA100|High Income Child Benefit Charge|2|Enter the number of children you and your partner got Child Benefit for on 5 April 2026|number
SA100|High Income Child Benefit Charge|3|Enter the date that you and your partner stopped getting all Child Benefit payments if this was before 6 April 2026|date
SA100|Marriage Allowance|1|Your spouse or civil partner's first name|text
SA100|Marriage Allowance|2|Your spouse or civil partner's last name|text
SA100|Marriage Allowance|3|Your spouse or civil partner's National Insurance number|text
SA100|Marriage Allowance|4|Your spouse or civil partner's date of birth|date
SA100|Marriage Allowance|5|Date of marriage or civil partnership|date
SA100|Winter Fuel Payment and Pension Age Winter Heating Payment charge|1|Enter the total amount of WFP or PAWHP you received for the tax year to 5 April 2026|money
SA100|Tax refunded or set off|1|If you've had any 2025–26 Income Tax refunded or set off by us or Jobcentre Plus, enter the amount|money
SA100|Any other information|19|Please give any other information in this space|text
SA100|Signing your form and sending it back|20|If this tax return contains provisional figures, put 'X' in the box|yesno
SA100|Signing your form and sending it back|21|If you're enclosing separate supplementary pages, put 'X' in the box|yesno
# --- SA101 additional information -------------------------------------------
SA101|Interest from gilt-edged and other UK securities|1|Gilt etc interest after tax taken off|money
SA101|Interest from gilt-edged and other UK securities|2|Tax taken off|money
SA101|Interest from gilt-edged and other UK securities|3|Gross amount before tax|money
SA101|Gains from life insurance policies, capital redemption policies and life annuity contracts|4|UK policy or contract gains on which tax was treated as paid – the amount of the gain|money
SA101|Gains from life insurance policies, capital redemption policies and life annuity contracts|5|Number of years the policy has been held or since the last gain|number
SA101|Gains from life insurance policies, capital redemption policies and life annuity contracts|6|UK policy or contract gains where no tax was treated as paid – the amount of the gain|money
SA101|Gains from life insurance policies, capital redemption policies and life annuity contracts|7|Number of years the policy has been held or since the last gain|number
SA101|Gains from life insurance policies, capital redemption policies and life annuity contracts|8|UK policy or contract gains from voided ISAs|money
SA101|Gains from life insurance policies, capital redemption policies and life annuity contracts|9|Number of years the policy was held|number
SA101|Gains from life insurance policies, capital redemption policies and life annuity contracts|10|Tax taken off gain shown in box 8|money
SA101|Gains from life insurance policies, capital redemption policies and life annuity contracts|11|Deficiency relief|money
SA101|Stock dividends, bonus issues of securities and redeemable shares|12|Stock dividends – the amount received|money
SA101|Stock dividends, bonus issues of securities and redeemable shares|13|Bonus issues of securities and redeemable shares|money
SA101|Stock dividends, bonus issues of securities and redeemable shares|13.1|Close company loans written off or released|money
SA101|Business receipts taxed as income of an earlier year|14|The amount of post-cessation or other business receipts|money
SA101|Business receipts taxed as income of an earlier year|15|Tax year income to be taxed, for example, 2024–25|text
SA101|Share schemes and employment lump sums|1|Share schemes – the taxable amount – excluding amounts included on your P60 or P45|money
SA101|Share schemes and employment lump sums|3|Taxable lump sums and certain income after the end of your job – excluding redundancy and compensation for loss of your job|money
SA101|Share schemes and employment lump sums|4|Lump sums or benefits received from an Employer Financed Retirement Benefits Scheme excluding pensions|money
SA101|Share schemes and employment lump sums|5|Redundancy, other lump sums and compensation payments – the amount above the £30,000 exemption|money
SA101|Share schemes and employment lump sums|6|Tax taken off boxes 3 to 5|money
SA101|Share schemes and employment lump sums|7|If you've left box 6 blank because the tax is included in box 2 on the 'Employment' page, put 'X' in the box|yesno
SA101|Share schemes and employment lump sums|8|Exemptions for amounts entered in box 4|money
SA101|Share schemes and employment lump sums|9|Compensation and lump sums up to £30,000 exemption|money
SA101|Share schemes and employment lump sums|10|Disability and foreign service deduction|money
SA101|Share schemes and employment lump sums|11|Seafarers' Earnings Deduction – enter pay on your 'Employment' page|money
SA101|Share schemes and employment lump sums|12|Foreign earnings not taxable in the UK|money
SA101|Share schemes and employment lump sums|13|Foreign tax for which tax credit relief not claimed|money
SA101|Share schemes and employment lump sums|14|Exempt employers' contributions to an overseas pension scheme|money
SA101|Share schemes and employment lump sums|15|UK patent royalty payments made|money
SA101|Other tax reliefs|1|Subscriptions for Venture Capital Trust shares – the amount on which relief is claimed|money
SA101|Other tax reliefs|2|Subscriptions for Enterprise Investment Scheme shares – the amount on which relief is claimed|money
SA101|Other tax reliefs|3|Community Investment Tax Relief – the amount on which relief is claimed|money
SA101|Other tax reliefs|4|Annual payments made|money
SA101|Other tax reliefs|5|Qualifying loan interest payable in the year|money
SA101|Other tax reliefs|6|Post-cessation trade relief and certain other losses|money
SA101|Other tax reliefs|6.1|Pre-incorporation losses|money
SA101|Other tax reliefs|7|Maintenance payments (up to £4,360) – if you or your former spouse or civil partner were born before 6 April 1935|money
SA101|Other tax reliefs|8|Payments to a trade union for death benefits – half the amount paid (maximum £100)|money
SA101|Other tax reliefs|9|Relief claimed on a qualifying distribution on the redemption of bonus shares or securities|money
SA101|Other tax reliefs|10|Subscriptions for shares under the Seed Enterprise Investment Scheme|money
SA101|Other tax reliefs|12|Non-deductible loan interest from investments into property letting partnerships|money
SA101|Income Tax losses and limit on Income Tax relief|1|Earlier years' losses – which can be set against certain other income in 2025–26|money
SA101|Income Tax losses and limit on Income Tax relief|2|Total unused losses carried forward|money
SA101|Income Tax losses and limit on Income Tax relief|3|Relief now for 2026–27 trade losses or certain capital losses|money
SA101|Income Tax losses and limit on Income Tax relief|4|Enter the amount of relief shown in box 3 which is not subject to the limit on Income Tax reliefs|money
SA101|Income Tax losses and limit on Income Tax relief|5|Tax year for which you're claiming relief in box 3, for example, 2024–25|text
SA101|Pension savings tax charges|10|Amount saved towards your pension, in the period covered by this tax return, in excess of the Annual Allowance|money
SA101|Pension savings tax charges|11|Annual Allowance tax paid or payable by your pension scheme|money
SA101|Pension savings tax charges|11.1|Value of pension benefits transferred subject to the overseas transfer charge|money
SA101|Pension savings tax charges|11.2|Tax paid by your pension scheme on your overseas transfer charge|money
SA101|Pension savings tax charges|12|Pension scheme tax reference number|text
SA101|Pension savings tax charges|13|Amount of unauthorised payment from a pension scheme, not subject to surcharge|money
SA101|Pension savings tax charges|14|Amount of unauthorised payment from a pension scheme, subject to surcharge|money
SA101|Pension savings tax charges|15|Foreign tax paid on an unauthorised payment (in £ sterling)|money
SA101|Pension savings tax charges|16|Taxable short service refund of contributions (overseas pension schemes only)|money
SA101|Pension savings tax charges|18|Foreign tax paid (in £ sterling) on box 16|money
SA101|Married couple's allowance|1|Your spouse's or civil partner's full name|text
SA101|Married couple's allowance|2|Their date of birth if older than you (and at least one of you was born before 6 April 1935)|date
SA101|Married couple's allowance|9|If you were married or formed a civil partnership after 5 April 2025, enter the date of marriage or civil partnership|date
SA101|Tax avoidance schemes|19|The scheme reference number or promoter reference number|text
SA101|Tax avoidance schemes|20|The tax year in which the expected advantage arises, for example, 2024–25|text
# --- SA102 employment -------------------------------------------------------
SA102|Employment|1|Pay from this employment – the total from your P45 or P60 – before tax was taken off|money
SA102|Employment|1.1|Payrolled benefits included in box 1 which affect your student loan repayments|money
SA102|Employment|2|UK tax taken off pay in box 1|money
SA102|Employment|3|Tips and other payments not on your P60|money
SA102|Employment|4|PAYE tax reference of your employer (on your P45/P60)|text
SA102|Employment|5|Your employer's name|text
SA102|Employment|6|Were you a director of this company|yesno
SA102|Employment|6.1|If you ceased being a director before 6 April 2026, put the date the directorship ceased|date
SA102|Employment|7|Was this company a close company|yesno
SA102|Employment|7.1|Name of this close company|text
SA102|Employment|7.2|Registration number of this close company|text
SA102|Employment|7.3|Dividends you received from this close company|money
SA102|Employment|7.4|Percentage shareholding in this close company|number
SA102|Employment|8|If this employment income is from inside off-payroll working engagements, put 'X' in the box|yesno
SA102|Benefits from your employment|9|Company cars and vans|money
SA102|Benefits from your employment|10|Fuel for company cars and vans|money
SA102|Benefits from your employment|11|Private medical and dental insurance|money
SA102|Benefits from your employment|12|Vouchers, credit cards and excess mileage allowance|money
SA102|Benefits from your employment|13|Goods and other assets provided by your employer|money
SA102|Benefits from your employment|14|Accommodation provided by your employer|money
SA102|Benefits from your employment|15|Other benefits (including interest-free and low interest loans)|money
SA102|Benefits from your employment|16|Expenses payments received and balancing charges|money
SA102|Employment expenses|17|Business travel and subsistence expenses|money
SA102|Employment expenses|18|Fixed deductions for expenses|money
SA102|Employment expenses|19|Professional fees and subscriptions|money
SA102|Employment expenses|20|Other expenses and capital allowances|money
# --- SA103S self-employment (short) -----------------------------------------
SA103S|Business details|1|Description of business|text
SA103S|Business details|2|Postcode of your business address|text
SA103S|Business details|4|If you are a foster carer or shared lives carer, put 'X' in the box|yesno
SA103S|Business details|5Q|Did this business start after 5 April 2025?|yesno
SA103S|Business details|5|If you answered 'Yes' in box 5Q, enter the date the business started|date
SA103S|Business details|6Q|Did this business cease after 5 April 2025 but before 6 April 2026?|yesno
SA103S|Business details|6|If you answered 'Yes' in box 6Q, enter the final date of trading|date
SA103S|Business details|7|Date your books or accounts are made up to|date
SA103S|Business details|8|If you've used traditional accounting rather than cash basis, put 'X' in the box|yesno
SA103S|Business income|9|Your turnover – the takings, fees, sales or money earned by your business|money
SA103S|Business income|10|Any other business income not included in box 9|money
SA103S|Business income|10.1|Trading income allowance|money
SA103S|Allowable business expenses|11|Costs of goods bought for resale or goods used|money
SA103S|Allowable business expenses|12|Car, van and travel expenses – after private use proportion|money
SA103S|Allowable business expenses|13|Wages, salaries and other staff costs|money
SA103S|Allowable business expenses|14|Rent, rates, power and insurance costs|money
SA103S|Allowable business expenses|15|Repairs and maintenance of property and equipment|money
SA103S|Allowable business expenses|16|Accountancy, legal and other professional fees|money
SA103S|Allowable business expenses|17|Interest and bank and credit card financial charges|money
SA103S|Allowable business expenses|18|Phone, fax, stationery and other office costs|money
SA103S|Allowable business expenses|19|Other allowable business expenses – client entertaining costs are not an allowable expense|money
SA103S|Allowable business expenses|20|Total allowable expenses – total of boxes 11 to 19|money
SA103S|Net profit or loss|21|Net profit – if your business income is more than your expenses|money
SA103S|Net profit or loss|22|Or, net loss – if your expenses exceed your business income|money
SA103S|Capital allowances|23|Annual Investment Allowance|money
SA103S|Capital allowances|24|Allowance for small balance of unrelieved expenditure|money
SA103S|Capital allowances|24.1|Zero-emission car allowance|money
SA103S|Capital allowances|25|Other capital allowances|money
SA103S|Capital allowances|25.1|The Structures and Buildings Allowance|money
SA103S|Capital allowances|25.2|Freeport and Investment Zones Structures and Buildings Allowance|money
SA103S|Capital allowances|26|Total balancing charges|money
SA103S|Calculating your taxable profit or loss|27|Goods and/or services for your own use|money
SA103S|Calculating your taxable profit or loss|28|Net business profit for tax purposes|money
SA103S|Calculating your taxable profit or loss|29|Loss brought forward from earlier years set off against this year's profits|money
SA103S|Calculating your taxable profit or loss|30|Any other business income not included in box 9 or box 10|money
SA103S|Total taxable profits or net business loss|31|Total taxable profits from this business|money
SA103S|Total taxable profits or net business loss|32|Net business loss for tax purposes|money
SA103S|Losses, Class 2 and Class 4 NICs and CIS deductions|33|Loss from this tax year set off against other income for 2025–26|money
SA103S|Losses, Class 2 and Class 4 NICs and CIS deductions|34|Loss to be carried back to previous years and set off against income (or capital gains)|money
SA103S|Losses, Class 2 and Class 4 NICs and CIS deductions|35|Total loss to carry forward after all other set-offs|money
SA103S|Losses, Class 2 and Class 4 NICs and CIS deductions|36|If your total profits for 2025–26 are less than £6,845 and you choose to pay Class 2 NICs voluntarily, put 'X' in the box|yesno
SA103S|Losses, Class 2 and Class 4 NICs and CIS deductions|37|If you're exempt from paying Class 4 NICs, put 'X' in the box|yesno
SA103S|Losses, Class 2 and Class 4 NICs and CIS deductions|38|Total Construction Industry Scheme (CIS) deductions taken from your payments by contractors|money
# --- SA105 UK property ------------------------------------------------------
SA105|UK property details|1|Number of properties rented out|number
SA105|UK property details|2|If all property income ceased in 2025–26 and you do not expect to receive such income in 2026–27, put 'X' in the box|yesno
SA105|UK property details|3|If you have any income from property let jointly, put 'X' in the box|yesno
SA105|UK property details|4|If you're claiming Rent a Room relief and your rents are £7,500 or less (or £3,750 if let jointly), put 'X' in the box|yesno
SA105|Property income|20|Total rents and other income from property|money
SA105|Property income|20.1|Property income allowance|money
SA105|Property income|20.2|If you've used traditional accounting rather than cash basis, put 'X' in the box|yesno
SA105|Property income|21|Tax taken off any income in box 20|money
SA105|Property income|22|Premiums for the grant of a lease|money
SA105|Property income|23|Reverse premiums and inducements|money
SA105|Property expenses|24|Rent, rates, insurance and ground rents|money
SA105|Property expenses|25|Property repairs and maintenance|money
SA105|Property expenses|26|Non-residential property finance costs|money
SA105|Property expenses|27|Legal, management and other professional fees|money
SA105|Property expenses|28|Costs of services provided, including wages|money
SA105|Property expenses|29|Other allowable property expenses|money
SA105|Calculating your taxable profit or loss|30|Private use adjustment|money
SA105|Calculating your taxable profit or loss|31|Balancing charges|money
SA105|Calculating your taxable profit or loss|32|Annual Investment Allowance|money
SA105|Calculating your taxable profit or loss|33|The Structures and Buildings Allowance|money
SA105|Calculating your taxable profit or loss|33.1|Electric charge-point allowance|money
SA105|Calculating your taxable profit or loss|33.2|Freeport and Investment Zones Structures and Buildings allowance|money
SA105|Calculating your taxable profit or loss|34.1|Zero-emission car allowance|money
SA105|Calculating your taxable profit or loss|35|All other capital allowances|money
SA105|Calculating your taxable profit or loss|36|Costs of replacing domestic items (for residential lettings only)|money
SA105|Calculating your taxable profit or loss|37|Rent a Room exempt amount|money
SA105|Calculating your taxable profit or loss|38|Adjusted profit for the year|money
SA105|Calculating your taxable profit or loss|39|Loss brought forward used against this year's profits|money
SA105|Calculating your taxable profit or loss|40|Taxable profit for the year (box 38 minus box 39)|money
SA105|Calculating your taxable profit or loss|41|Adjusted loss for the year|money
SA105|Calculating your taxable profit or loss|42|Loss set off against 2025–26 total income – this will be unusual|money
SA105|Calculating your taxable profit or loss|43|Loss to carry forward to following year, including unused losses brought forward|money
SA105|Residential property finance costs|44|Residential property finance costs|money
SA105|Residential property finance costs|45|Unused residential property finance costs brought forward|money
# --- SA108 capital gains ----------------------------------------------------
SA108|Residential property and carried interest|3|Number of disposals|number
SA108|Residential property and carried interest|4|Disposal proceeds|money
SA108|Residential property and carried interest|5|Allowable costs (including purchase price)|money
SA108|Residential property and carried interest|6|Gains on residential property in the year, before losses|money
SA108|Residential property and carried interest|6.1|Amount claimed under the foreign income and gains (FIG) regime|money
SA108|Residential property and carried interest|7|Losses in the year|money
SA108|Residential property and carried interest|8|If you're making any claim or election, put the relevant code in the box|text
SA108|Residential property and carried interest|9|Total gains or losses on UK residential property reported on Capital Gains Tax UK Property Disposal returns|money
SA108|Residential property and carried interest|10|Tax on gains in box 9 already charged|money
SA108|Residential property and carried interest|11|Total gains or losses on non-UK residential property or carried interest reported on Real Time Transaction returns|money
SA108|Residential property and carried interest|12|Tax on gains in box 11 already paid|money
SA108|Residential property and carried interest|13|Carried interest (arising basis)|money
SA108|Residential property and carried interest|13A|Carried interest (accruals basis)|money
SA108|Residential property and carried interest|13B|Gains on carried interest in the year|money
SA108|Cryptoassets|13.1|Number of disposals|number
SA108|Cryptoassets|13.2|Disposal proceeds|money
SA108|Cryptoassets|13.3|Allowable costs (including purchase price)|money
SA108|Cryptoassets|13.4|Gains in the year, before losses|money
SA108|Cryptoassets|13.5|Losses in the year|money
SA108|Cryptoassets|13.6|If you're making any claim or election, put the relevant code in the box|text
SA108|Cryptoassets|13.7|Total gains or losses on the disposal of an asset of this type reported on Real Time Transaction returns|money
SA108|Cryptoassets|13.8|Tax on gains in box 13.7 already paid|money
SA108|Other property, assets and gains|14|Number of disposals|number
SA108|Other property, assets and gains|15|Disposal proceeds|money
SA108|Other property, assets and gains|16|Allowable costs (including purchase price)|money
SA108|Other property, assets and gains|17|Gains in the year, before losses|money
SA108|Other property, assets and gains|17.0|Amount claimed under the foreign income and gains (FIG) regime|money
SA108|Other property, assets and gains|17.1|Amount included in box 17 relating to disposals of non-residential land and buildings|money
SA108|Other property, assets and gains|17.2|Residential property and non-residential land and buildings|money
SA108|Other property, assets and gains|17.3|Listed and unlisted shares and securities|money
SA108|Other property, assets and gains|17.4|Other assets|money
SA108|Other property, assets and gains|19|Losses in the year|money
SA108|Other property, assets and gains|20|If you're making any claim or election, put the relevant code in the box|text
SA108|Other property, assets and gains|21|Total gains or losses on the disposal of an asset of this type reported on Real Time Transaction returns|money
SA108|Other property, assets and gains|22|Tax on gains in box 21 already paid|money
SA108|Listed shares and securities|23|Number of disposals|number
SA108|Listed shares and securities|24|Disposal proceeds|money
SA108|Listed shares and securities|25|Allowable costs (including purchase price)|money
SA108|Listed shares and securities|26|Gains in the year, before losses|money
SA108|Listed shares and securities|26.1|Amount claimed under the foreign income and gains (FIG) regime|money
SA108|Listed shares and securities|27|Losses in the year|money
SA108|Listed shares and securities|28|If you're making any claim or election, put the relevant code in the box|text
SA108|Listed shares and securities|29|Total gains or losses on the disposal of an asset of this type reported on Real Time Transaction returns|money
SA108|Listed shares and securities|30|Tax on gains in box 29 already paid|money
SA108|Unlisted shares and securities|31|Number of disposals|number
SA108|Unlisted shares and securities|32|Disposal proceeds|money
SA108|Unlisted shares and securities|33|Allowable costs (including purchase price)|money
SA108|Unlisted shares and securities|34|Gains in the year, before losses|money
SA108|Unlisted shares and securities|34.1|Amount claimed under the foreign income and gains (FIG) regime|money
SA108|Unlisted shares and securities|35|Losses in the year|money
SA108|Unlisted shares and securities|36|If you're making any claim or election, put the relevant code in the box|text
SA108|Unlisted shares and securities|37|Total gains or losses on the disposal of an asset of this type reported on Real Time Transaction returns|money
SA108|Unlisted shares and securities|38|Tax on gains in box 37 already paid|money
SA108|Losses and adjustments|39|Gains exceeding the lifetime limit for employee shareholder status shares|money|?
SA108|Losses and adjustments|40|Gains invested under Seed Enterprise Investment Scheme and qualifying for relief|money|?
SA108|Losses and adjustments|41|Losses used against income – amount claimed against 2025–26 income|money|?
SA108|Losses and adjustments|42|Amount in box 41 relating to share loss relief to which EIS or SEIS Relief is attributable|money|?
SA108|Losses and adjustments|43|Losses used against income – amount claimed against 2024–25 income|money|?
SA108|Losses and adjustments|44|Amount in box 43 relating to share loss relief to which EIS or SEIS Relief is attributable|money|?
SA108|Losses set against 2025–26 capital gains|45|Losses brought forward and used in-year|money
SA108|Losses set against 2025–26 capital gains|46|Income losses of 2025–26 set against gains|money
SA108|Capital losses – other information|47|Losses available to be carried forward|money
SA108|Capital losses – other information|48|Losses used against an earlier year's gain|money
SA108|Investors' Relief and Business Asset Disposal Relief|49|Gains qualifying for Investors' Relief|money
SA108|Investors' Relief and Business Asset Disposal Relief|50|Gains qualifying for Business Asset Disposal Relief|money
SA108|Investors' Relief and Business Asset Disposal Relief|50.1|Lifetime allowance of Business Asset Disposal Relief and Entrepreneurs' Relief claimed – the total amount claimed to date|money
SA108|Tax adjustments to capital gains|51|Adjustments to Capital Gains Tax|money
SA108|Tax adjustments to capital gains|52|Additional liability for non-resident or dual resident trusts|money
SA108|Any other information|53|If your computations include any estimates or valuations, put 'X' in the box|yesno
SA108|Any other information|54|Please give any other information in this space|text
# --- SA107 trusts etc -------------------------------------------------------
SA107|Discretionary income payment from a UK resident trust|1|Net amount – after tax taken off|money
SA107|Discretionary income payment from a UK resident trust|2|Total payments from settlor-interested trusts|money
SA107|Non-discretionary income entitlement from a trust|3|Net amount of non-savings income – after tax taken off|money
SA107|Non-discretionary income entitlement from a trust|4|Net amount of savings income – after tax taken off|money
SA107|Non-discretionary income entitlement from a trust|5|Net amount of dividend income – after tax taken off|money
SA107|Income from trusts and settlements|6|If you've included income from trusts or settlements whose trustees are not resident in the UK, put 'X' in the box|yesno|?
SA107|Income chargeable on settlors|7|Net amount of non-savings income taxed at basic rate – after tax taken off|money
SA107|Income chargeable on settlors|8|Net amount of savings income taxed at basic rate – after tax taken off|money
SA107|Income chargeable on settlors|9|Net amount of dividend income taxed at dividend rate – after tax taken off|money
SA107|Income chargeable on settlors|10|Net amount of non-savings income taxed at trust rate – after tax taken off|money
SA107|Income chargeable on settlors|11|Net amount of savings income taxed at trust rate – after tax taken off|money
SA107|Income chargeable on settlors|12|Net amount of dividend income taxed at dividend trust rate – after tax taken off|money
SA107|Income chargeable on settlors|13|Non-savings income paid gross|money
SA107|Income chargeable on settlors|14|Savings income paid gross|money
SA107|Income chargeable on settlors|15|Additional tax paid by the trustees on certain UK life insurance policy gains|money
SA107|Income from the estates of deceased persons|16|Non-savings income – after tax taken off|money
SA107|Income from the estates of deceased persons|17|Savings income – after tax taken off|money
SA107|Income from the estates of deceased persons|18|Dividend income – after tax taken off|money
SA107|Income from the estates of deceased persons|18.1|Dividend income that has been taxed at 7.5% – after tax taken off|money
SA107|Income from the estates of deceased persons|19|Non-savings income taxed at non-repayable basic rate – after tax taken off|money
SA107|Foreign estate income|22|Foreign estate income|money
SA107|Foreign estate income|22.1|Amount claimed under the foreign income and gains (FIG) regime|money
SA107|Foreign estate income|23|Relief for UK tax already accounted for|money
SA107|Foreign estate income|24|Foreign tax for which Foreign Tax Credit Relief has not been claimed|money
SA107|Residential property finance costs|25|Amount of residential property income or restricted finance costs from trusts and estates|money
SA107|Residential property finance costs|25.1|Unused residential property finance costs brought forward|money
SA107|Any other information|26|Please give any other information in this space|text
# --- SA104S partnership (short) ---------------------------------------------
SA104S|Partnership details|1|Partnership reference number|text
SA104S|Partnership details|2|Description of partnership trade or profession|text
SA104S|Partnership details|3Q|Did you become a partner in this partnership after 5 April 2025?|yesno
SA104S|Partnership details|3|If you answered 'Yes' in box 3Q, enter the date you became a partner|date
SA104S|Partnership details|4Q|Did you cease being a partner after 5 April 2025 but before 6 April 2026?|yesno
SA104S|Partnership details|4|If you answered 'Yes' in box 4Q, enter the date you left this partnership|date
SA104S|Your share of the partnership's trading or professional profits|8|Your share of the partnership's profit or loss|money
SA104S|Your share of the partnership's trading or professional profits|9|Adjustment where the partnership's accounting period ended before 31 March 2026 or was not 12 months long|money
SA104S|Your share of the partnership's trading or professional profits|10|Adjustment for change of accounting practice|money
SA104S|Your share of the partnership's trading or professional profits|11|Averaging adjustment – only for farmers, market gardeners and creators of literary or artistic works|money
SA104S|Your share of the partnership's trading or professional profits|12|Foreign tax claimed as a deduction|money
SA104S|Your share of the partnership's trading or professional profits|16|Adjusted profit for 2025–26|money
SA104S|Your share of the partnership's trading or professional profits|17|Losses brought forward from earlier years set off against this year's profit|money
SA104S|Your share of the partnership's trading or professional profits|18|Taxable profits after losses brought forward|money
SA104S|Your share of the partnership's trading or professional profits|19|Any other business income not included in the partnership accounts|money
SA104S|Your share of the partnership's trading or professional profits|20|Your share of total taxable profits from the partnership's business for 2025–26|money
SA104S|Your share of the partnership's trading or professional losses|21|Adjusted loss for 2025–26|money
SA104S|Your share of the partnership's trading or professional losses|22|Loss from this tax year set off against other income for 2025–26|money
SA104S|Your share of the partnership's trading or professional losses|23|Loss to be carried back to previous years and set off against income (or capital gains)|money
SA104S|Your share of the partnership's trading or professional losses|24|Total loss to carry forward after all other set-offs|money
SA104S|Class 2 and Class 4 National Insurance contributions|25|If your total profits for 2025–26 are less than £6,845 and you choose to pay Class 2 NICs voluntarily, put 'X' in the box|yesno
SA104S|Class 2 and Class 4 National Insurance contributions|26|If you're exempt from paying Class 4 NICs, put 'X' in the box|yesno
SA104S|Class 2 and Class 4 National Insurance contributions|27|Adjustment to profits chargeable to Class 4 NICs|money
SA104S|Your share of the partnership's untaxed income|28|Your share of untaxed interest – from box 13 on the Partnership Statement|money|?
SA104S|Your share of the partnership's tax paid and deductions|30|Your share of Construction Industry Scheme deductions made by contractors|money|?
SA104S|Your share of the partnership's tax paid and deductions|31|Your share of any tax taken off trading income (not contractor deductions)|money|?
SA104S|Any other information|32|Please give any other information in this space|text
# --- SA103F self-employment (full) ------------------------------------------
SA103F|Business details|1|Business name – unless it's in your own name|text
SA103F|Business details|2|Description of business|text
SA103F|Business details|3|First line of your business address – unless you work from home|text
SA103F|Business details|4|Postcode of your business address|text
SA103F|Business details|5|If the details in boxes 1, 2, 3 or 4 have changed in the last 12 months, put 'X' in the box|yesno
SA103F|Business details|6Q|Did this business start after 5 April 2025?|yesno
SA103F|Business details|6|If you answered 'Yes' in box 6Q, enter the date the business started|date
SA103F|Business details|7Q|Did this business cease after 5 April 2025 but before 6 April 2026?|yesno
SA103F|Business details|7|If you answered 'Yes' in box 7Q, enter the final date of trading|date
SA103F|Business details|8|Date your books or accounts start – the beginning of your accounting period|date
SA103F|Business details|9|Date your books or accounts are made up to or the end of your accounting period|date
SA103F|Business details|10|If you used traditional accounting rather than cash basis to calculate your income and expenses, put 'X' in the box|yesno
SA103F|Business details|13|If special arrangements apply, put 'X' in the box|yesno|?
SA103F|Business details|14|If you provided the information about your 2025–26 profit on last year's tax return, put 'X' in the box|yesno|?
SA103F|Business income|15|Your turnover – the takings, fees, sales or money earned by your business|money
SA103F|Business income|16|Any other business income not included in box 15|money
SA103F|Business income|16.1|Trading income allowance|money
SA103F|Business expenses|17|Cost of goods bought for resale or goods used|money
SA103F|Business expenses|18|Construction industry – payments to subcontractors|money
SA103F|Business expenses|19|Wages, salaries and other staff costs|money
SA103F|Business expenses|20|Car, van and travel expenses|money
SA103F|Business expenses|21|Rent, rates, power and insurance costs|money
SA103F|Business expenses|22|Repairs and maintenance of property and equipment|money
SA103F|Business expenses|23|Phone, fax, stationery and other office costs|money
SA103F|Business expenses|24|Advertising and business entertainment costs|money
SA103F|Business expenses|25|Interest on bank and other loans|money
SA103F|Business expenses|26|Bank, credit card and other financial charges|money
SA103F|Business expenses|27|Irrecoverable debts written off|money
SA103F|Business expenses|28|Accountancy, legal and other professional fees|money
SA103F|Business expenses|29|Depreciation and loss or profit on sale of assets|money
SA103F|Business expenses|30|Other business expenses|money
SA103F|Business expenses|31|Total expenses|money
SA103F|Disallowable expenses|32|Cost of goods bought for resale or goods used – disallowable amount|money|?
SA103F|Disallowable expenses|33|Construction industry payments to subcontractors – disallowable amount|money|?
SA103F|Disallowable expenses|34|Wages, salaries and other staff costs – disallowable amount|money|?
SA103F|Disallowable expenses|35|Car, van and travel expenses – disallowable amount|money|?
SA103F|Disallowable expenses|36|Rent, rates, power and insurance costs – disallowable amount|money|?
SA103F|Disallowable expenses|37|Repairs and maintenance of property and equipment – disallowable amount|money|?
SA103F|Disallowable expenses|38|Phone, fax, stationery and other office costs – disallowable amount|money|?
SA103F|Disallowable expenses|39|Advertising and business entertainment costs – disallowable amount|money|?
SA103F|Disallowable expenses|40|Interest on bank and other loans – disallowable amount|money|?
SA103F|Disallowable expenses|41|Bank, credit card and other financial charges – disallowable amount|money|?
SA103F|Disallowable expenses|42|Irrecoverable debts written off – disallowable amount|money|?
SA103F|Disallowable expenses|43|Accountancy, legal and other professional fees – disallowable amount|money|?
SA103F|Disallowable expenses|44|Depreciation and loss or profit on sale of assets – disallowable amount|money|?
SA103F|Disallowable expenses|45|Other business expenses – disallowable amount|money|?
SA103F|Disallowable expenses|46|Total disallowable expenses|money
SA103F|Net profit or loss|47|Net profit – if your business income is more than your expenses|money
SA103F|Net profit or loss|48|Net loss – if your expenses are more than your business income|money
SA103F|Tax allowances for vehicles and equipment (capital allowances)|49|Annual Investment Allowance|money
SA103F|Tax allowances for vehicles and equipment (capital allowances)|50|Capital allowances at 18% on equipment, including cars with lower CO2 emissions|money
SA103F|Tax allowances for vehicles and equipment (capital allowances)|51|Capital allowances at 6% on equipment, including cars with higher CO2 emissions|money
SA103F|Tax allowances for vehicles and equipment (capital allowances)|52|Zero-emission goods vehicle allowance|money
SA103F|Tax allowances for vehicles and equipment (capital allowances)|52.1|Zero-emission car allowance|money
SA103F|Tax allowances for vehicles and equipment (capital allowances)|53|The Structures and Buildings Allowance|money
SA103F|Tax allowances for vehicles and equipment (capital allowances)|53.1|Freeport and Investment Zones Structures and Buildings Allowance|money
SA103F|Tax allowances for vehicles and equipment (capital allowances)|54|Electric charge-point allowance|money
SA103F|Tax allowances for vehicles and equipment (capital allowances)|55|100% and other enhanced capital allowances|money
SA103F|Tax allowances for vehicles and equipment (capital allowances)|56|Allowances on sale or cessation of business use, where you've disposed of assets for less than their tax value|money
SA103F|Tax allowances for vehicles and equipment (capital allowances)|57|Total capital allowances|money
SA103F|Tax allowances for vehicles and equipment (capital allowances)|59|Balancing charge on sales of assets or on the cessation of business use|money
SA103F|Calculating your taxable profit or loss|60|Goods and services for your own use|money
SA103F|Calculating your taxable profit or loss|61|Total additions to net profit or deductions from net loss|money
SA103F|Calculating your taxable profit or loss|62|Income, receipts and other profits included in business income or expenses but not taxable as business profits|money
SA103F|Calculating your taxable profit or loss|63|Total deductions from net profit or additions to net loss|money
SA103F|Calculating your taxable profit or loss|64|Net business profit for tax purposes|money
SA103F|Calculating your taxable profit or loss|65|Net business loss for tax purposes|money
SA103F|Calculating your taxable profit or loss|68|Adjustment where your accounting period ended before 31 March 2026 or where your accounting period was not 12 months long|money
SA103F|Calculating your taxable profit or loss|71|Adjustment for change of accounting practice|money
SA103F|Calculating your taxable profit or loss|72|Averaging adjustment – only for farmers, market gardeners and creators of literary or artistic works|money
SA103F|Calculating your taxable profit or loss|73|Adjusted profit for 2025–26|money
SA103F|Calculating your taxable profit or loss|73.3|Spread of the transition profit treated as arising in this tax year|money
SA103F|Calculating your taxable profit or loss|73.4|Loss brought forward from earlier years set off against this year's spread of the transition profit|money
SA103F|Calculating your taxable profit or loss|74|Loss brought forward from earlier years set off against this year's adjusted profit|money
SA103F|Calculating your taxable profit or loss|75|Any other business income not included in boxes 15, 16 or 60|money
SA103F|Calculating your taxable profit or loss|76|Total taxable profits from this business|money
SA103F|Calculating your taxable profit or loss|76.1|Amount claimed under the foreign income and gains (FIG) regime|money
SA103F|Losses|77|Adjusted loss for 2025–26|money
SA103F|Losses|77.1|Adjustment to losses as a result of a claim under the foreign income and gains (FIG) regime|money
SA103F|Losses|78|Loss from this tax year set off against other income for 2025–26|money
SA103F|Losses|79|Loss to be carried back to previous years and set off against income (or capital gains)|money
SA103F|Losses|80|Total loss to carry forward after all other set-offs – including unused losses brought forward|money
SA103F|CIS deductions and tax taken off|81|Total Construction Industry Scheme (CIS) deductions taken from your payments by contractors|money
SA103F|CIS deductions and tax taken off|82|Other tax taken off trading income|money
SA103F|Balance sheet|83|Equipment, machinery and vehicles|money
SA103F|Balance sheet|84|Other fixed assets|money
SA103F|Balance sheet|85|Stock and work in progress|money
SA103F|Balance sheet|86|Trade debtors|money
SA103F|Balance sheet|87|Bank or building society balances|money
SA103F|Balance sheet|88|Cash in hand|money
SA103F|Balance sheet|89|Other current assets and prepayments|money
SA103F|Balance sheet|90|Total assets|money
SA103F|Balance sheet|91|Trade creditors|money
SA103F|Balance sheet|92|Loans and overdrawn bank account balances|money
SA103F|Balance sheet|93|Other liabilities and accruals|money
SA103F|Balance sheet|94|Net business assets|money
SA103F|Balance sheet|95|Balance at start of period|money
SA103F|Balance sheet|96|Net profit or loss|money
SA103F|Balance sheet|97|Capital introduced|money
SA103F|Balance sheet|98|Drawings|money
SA103F|Balance sheet|99|Balance at end of period|money
SA103F|Class 2 and Class 4 National Insurance contributions|100|If your total profits for 2025–26 are less than £6,845 and you choose to pay Class 2 NICs voluntarily, put 'X' in the box|yesno
SA103F|Class 2 and Class 4 National Insurance contributions|101|If you're exempt from paying Class 4 NICs, put 'X' in the box|yesno
SA103F|Class 2 and Class 4 National Insurance contributions|102|Adjustment to profits chargeable to Class 4 NICs|money
SA103F|Any other information|103|Please give any other information in this space|text
# --- SA104F partnership (full) ----------------------------------------------
SA104F|Partnership details|1|Partnership reference number|text
SA104F|Partnership details|2|Description of partnership trade or profession|text
SA104F|Partnership details|3Q|Did you become a partner in this partnership after 5 April 2025?|yesno
SA104F|Partnership details|3|If you answered 'Yes' in box 3Q, enter the date you became a partner|date
SA104F|Partnership details|4Q|Did you cease being a partner in this partnership after 5 April 2025 but before 6 April 2026?|yesno
SA104F|Partnership details|4|If you answered 'Yes' in box 4Q, enter the date you left this partnership|date
SA104F|Your share of the partnership's trading or professional profits|8|Your share of the partnership's profit or loss – from box 11 or box 12 on the Partnership Statement|money
SA104F|Your share of the partnership's trading or professional profits|9|Adjustment where the partnership's accounting period ended before 31 March 2026 or was not 12 months long|money
SA104F|Your share of the partnership's trading or professional profits|10|Adjustment for change of accounting practice – from box 11A on the Partnership Statement|money
SA104F|Your share of the partnership's trading or professional profits|11|Averaging adjustment – only for farmers, market gardeners and creators of literary or artistic works|money
SA104F|Your share of the partnership's trading or professional profits|12|Foreign tax claimed as a deduction – only if Foreign Tax Credit Relief is not being claimed on the Foreign pages|money
SA104F|Your share of the partnership's trading or professional profits|16|Adjusted profit for 2025–26|money
SA104F|Your share of the partnership's trading or professional profits|16.3|Spread of the transition profit treated as arising in this tax year|money
SA104F|Your share of the partnership's trading or professional profits|16.4|Loss brought forward from earlier years set off against this year's spread of the transition profit|money
SA104F|Your share of the partnership's trading or professional profits|17|Losses brought forward from earlier years set off against this year's adjusted profit|money
SA104F|Your share of the partnership's trading or professional profits|18|Taxable profits after losses brought forward – do not include the amount in box 16.3|money
SA104F|Your share of the partnership's trading or professional profits|19|Any other business income not included in the partnership accounts|money
SA104F|Your share of the partnership's trading or professional profits|20|Your share of the total taxable profits from the partnership's business for 2025–26|money
SA104F|Your share of the partnership's trading or professional profits|20.1|Amount claimed under the foreign income and gains (FIG) regime|money
SA104F|Your share of the partnership's trading or professional losses|21|Adjusted loss for 2025–26|money
SA104F|Your share of the partnership's trading or professional losses|21.1|Adjustment to losses as a result of a claim under the foreign income and gains (FIG) regime|money
SA104F|Your share of the partnership's trading or professional losses|22|Loss from this tax year set off against other income for 2025–26|money
SA104F|Your share of the partnership's trading or professional losses|23|Loss to be carried back to previous years and set off against income (or capital gains)|money
SA104F|Your share of the partnership's trading or professional losses|24|Total loss to carry forward after all other set-offs – including unused losses brought forward|money
SA104F|Class 2 and Class 4 National Insurance contributions|25|If your total profits for 2025–26 are less than £6,845 and you choose to pay Class 2 NICs voluntarily, put 'X' in the box|yesno
SA104F|Class 2 and Class 4 National Insurance contributions|26|If you're exempt from paying Class 4 NICs, put 'X' in the box|yesno
SA104F|Class 2 and Class 4 National Insurance contributions|27|Adjustment to profits chargeable to Class 4 NICs|money
SA104F|Untaxed savings income|28|Share of UK untaxed savings income – from box 13 on the Partnership Statement|money
SA104F|Untaxed savings income|29|Adjustment to untaxed savings income including adjustment for the tax year|money
SA104F|Untaxed savings income|30|Adjusted UK savings income|money
SA104F|Untaxed savings income|31|Share of foreign untaxed savings income – from box 14 on the Partnership Statement|money
SA104F|Untaxed savings income|32|Adjustment to foreign savings income including adjustment for the tax year|money
SA104F|Untaxed savings income|33|Total foreign tax taken off – only if Foreign Tax Credit Relief is not being claimed on the Foreign pages|money
SA104F|Untaxed savings income|34|Adjusted foreign savings income|money
SA104F|Untaxed savings income|35|Total untaxed savings income taxable at 20%|money
SA104F|Untaxed savings income|35.1|Amount claimed under the foreign income and gains (FIG) regime|money
SA104F|Income from UK property|36|Share of profit or loss for 2025–26 from UK property – from box 19 on the Partnership Statement|money
SA104F|Income from UK property|37|Adjustment to profit or loss from UK property including adjustment for the tax year|money
SA104F|Income from UK property|38|Losses brought forward from earlier years set off against profits|money
SA104F|Income from UK property|39|Loss set off against 2025–26 total income – this will be unusual|money
SA104F|Income from UK property|40|Loss to be carried forward after any set-offs – including unused losses brought forward|money
SA104F|Income from UK property|41|Taxable profit after adjustments and losses|money
SA104F|Income from UK property|41.1|Residential property finance costs – from box 26 on the Partnership Statement|money
SA104F|Income from UK property|41.2|Unused residential property finance costs brought forward|money
SA104F|Other untaxed UK income|45|Share of other untaxed UK income – from box 15 on the Partnership Statement|money
SA104F|Other untaxed UK income|46|Adjustment to other untaxed UK income including adjustment for the tax year|money
SA104F|Other untaxed UK income|47|Losses brought forward from earlier years set off against income|money
SA104F|Other untaxed UK income|48|Taxable profit|money
SA104F|Other untaxed UK income|49|Share of loss for 2025–26 from other untaxed UK income – from box 16 on the Partnership Statement|money
SA104F|Other untaxed UK income|50|Adjustment to loss from other untaxed UK income|money
SA104F|Other untaxed UK income|51|Total loss to carry forward after all other set-offs – including unused losses brought forward|money
SA104F|Income from offshore funds|52|Share of income from offshore funds – from box 18 on the Partnership Statement|money
SA104F|Income from offshore funds|53|Adjustment to income from offshore funds including adjustment for the tax year|money
SA104F|Income from offshore funds|54|Total foreign tax taken off – only if Foreign Tax Credit Relief is not being claimed on the Foreign pages|money
SA104F|Income from offshore funds|55|Taxable income after adjustments and foreign tax|money
SA104F|Income from offshore funds|55.1|Amount claimed under the foreign income and gains (FIG) regime|money
SA104F|Other untaxed foreign income|56|Share of other untaxed foreign income – from box 17 on the Partnership Statement|money
SA104F|Other untaxed foreign income|57|Adjustment to other untaxed foreign income including adjustment for the tax year|money
SA104F|Other untaxed foreign income|58|Losses brought forward from earlier years set off against income|money
SA104F|Other untaxed foreign income|59|Total foreign tax taken off – only if Foreign Tax Credit Relief is not being claimed on the Foreign pages|money
SA104F|Other untaxed foreign income|60|Taxable profit|money
SA104F|Other untaxed foreign income|60.1|Amount claimed under the foreign income and gains (FIG) regime|money
SA104F|Other untaxed foreign income|61|Share of loss for 2025–26 from other untaxed foreign income – from box 21 on the Partnership Statement|money
SA104F|Other untaxed foreign income|62|Adjustment to loss from other untaxed foreign income|money
SA104F|Other untaxed foreign income|63|Total loss to carry forward after all other set-offs – including unused losses brought forward|money
SA104F|Other untaxed foreign income|63.1|Residential property finance costs – from box 27 on the Partnership Statement|money
SA104F|Other untaxed foreign income|63.2|Unused residential property finance costs brought forward|money
SA104F|Your share of the partnership's untaxed income|67|Share of total untaxed income – other than savings income|money|?
SA104F|Your share of the partnership's taxed income and dividend income|68|Dividend income – from boxes 14A and 22A on the Partnership Statement|money
SA104F|Your share of the partnership's taxed income and dividend income|69|Total foreign tax taken off – only if Foreign Tax Credit Relief is not being claimed on the Foreign pages|money
SA104F|Your share of the partnership's taxed income and dividend income|70|Total dividend income|money
SA104F|Your share of the partnership's taxed income and dividend income|70.1|Amount claimed under the foreign income and gains (FIG) regime|money
SA104F|Your share of the partnership's taxed income and dividend income|71|Share of taxed income taxable at 20% – from box 22 on the Partnership Statement|money
SA104F|Your share of the partnership's taxed income and dividend income|72|Total foreign tax taken off – only if Foreign Tax Credit Relief is not being claimed on the Foreign pages|money
SA104F|Your share of the partnership's taxed income and dividend income|73|Taxed income taxable at 20%|money
SA104F|Your share of the partnership's taxed income and dividend income|74|Share of other taxed income – from box 23 on the Partnership Statement|money
SA104F|Your share of the partnership's taxed income and dividend income|75|Total foreign tax taken off – only if Foreign Tax Credit Relief is not being claimed on the Foreign pages|money
SA104F|Your share of the partnership's taxed income and dividend income|75.1|Amount claimed under the foreign income and gains (FIG) regime|money
SA104F|Your share of the partnership's total taxed and untaxed income|76|Share of total taxed and untaxed income other than that taxable at 10% and 20%|money
SA104F|Your share of the partnership's total taxed and untaxed income|76.1|Amount claimed under the foreign income and gains (FIG) regime in respect of that income|money
SA104F|Your share of the partnership's tax paid and deductions|77|Share of Income Tax taken off partnership income – from box 25 on the Partnership Statement|money
SA104F|Your share of the partnership's tax paid and deductions|78|Share of Construction Industry Scheme (CIS) deductions made by contractors – from box 24 on the Partnership Statement|money
SA104F|Your share of the partnership's tax paid and deductions|79|Share of any tax taken off trading income (not contractor deductions) – from box 24A on the Partnership Statement|money
SA104F|Your share of the partnership's tax paid and deductions|80|Share of total tax taken off|money
# --- SA106 foreign ----------------------------------------------------------
# The lettered boxes A to F are the columns of a per-country table. The portal
# holds one row; a second country needs a second row on the paper return.
SA106|Unremittable income|1|If you were unable to transfer any of your overseas income to the UK, put 'X' in the box|yesno
SA106|Foreign Tax Credit Relief|2|If you're calculating your tax, enter the total Foreign Tax Credit Relief on your income|money|?
SA106|Interest and other income from overseas savings|A|Country or territory code|text
SA106|Interest and other income from overseas savings|B|Amount of income arising or received before any tax taken off|money
SA106|Interest and other income from overseas savings|C|Foreign tax taken off or paid|money
SA106|Interest and other income from overseas savings|D|Special Withholding Tax and any UK tax taken off|money
SA106|Interest and other income from overseas savings|E|To claim Foreign Tax Credit Relief, put 'X' in the box|yesno
SA106|Interest and other income from overseas savings|F|Taxable amount – if claiming Foreign Tax Credit Relief, copy column B here; if not, enter column B minus column C|money
SA106|Interest and other income from overseas savings|3|Total foreign tax and Special Withholding Tax|money
SA106|Interest and other income from overseas savings|4|Total taxable amount|money
SA106|Interest and other income from overseas savings|4.1|Total claimed under the FIG regime|money
SA106|Dividends from foreign companies|A|Country or territory code|text
SA106|Dividends from foreign companies|B|Amount of income arising or received before any tax taken off|money
SA106|Dividends from foreign companies|C|Foreign tax taken off or paid|money
SA106|Dividends from foreign companies|D|Special Withholding Tax and any UK tax taken off|money
SA106|Dividends from foreign companies|E|To claim Foreign Tax Credit Relief, put 'X' in the box|yesno
SA106|Dividends from foreign companies|F|Taxable amount|money
SA106|Dividends from foreign companies|5|Total foreign tax and Special Withholding Tax|money
SA106|Dividends from foreign companies|6|Total taxable amount|money
SA106|Dividends from foreign companies|6.1|Total claimed under the FIG regime|money
SA106|Remitted foreign income excluding dividends|7.1|Special Withholding Tax and any UK tax taken off|money|?
SA106|Remitted foreign income excluding dividends|7.2|Taxable amount|money|?
SA106|Remitted foreign dividend income|7.3|Special Withholding Tax and any UK tax taken off|money|?
SA106|Remitted foreign dividend income|7.4|Taxable amount|money|?
SA106|Remitted foreign dividend income|7.5|Amount in box 7.4 subject to dividend tax credit|money|?
SA106|Overseas pensions, social security benefits and royalties|A|Country or territory code|text
SA106|Overseas pensions, social security benefits and royalties|B|Amount of income arising or received before any tax taken off|money
SA106|Overseas pensions, social security benefits and royalties|C|Foreign tax taken off or paid|money
SA106|Overseas pensions, social security benefits and royalties|D|Special Withholding Tax and any UK tax taken off|money
SA106|Overseas pensions, social security benefits and royalties|E|To claim Foreign Tax Credit Relief, put 'X' in the box|yesno
SA106|Overseas pensions, social security benefits and royalties|F|Taxable amount|money
SA106|Overseas pensions, social security benefits and royalties|8|Total foreign tax and Special Withholding Tax|money
SA106|Overseas pensions, social security benefits and royalties|9|Total taxable amount|money
SA106|Overseas pensions, social security benefits and royalties|9.1|Total claimed under the FIG regime|money
SA106|Dividend income received by a person abroad|A|Country or territory code|text
SA106|Dividend income received by a person abroad|B|Amount of income arising or received before any tax taken off|money
SA106|Dividend income received by a person abroad|C|Foreign tax taken off or paid|money
SA106|Dividend income received by a person abroad|D|Special Withholding Tax and any UK tax taken off|money
SA106|Dividend income received by a person abroad|E|To claim Foreign Tax Credit Relief, put 'X' in the box|yesno
SA106|Dividend income received by a person abroad|F|Taxable amount|money
SA106|Dividend income received by a person abroad|10|Total foreign tax and Special Withholding Tax|money
SA106|Dividend income received by a person abroad|11|Total taxable amount|money
SA106|Dividend income received by a person abroad|11.1|Total claimed under the FIG regime|money
SA106|All other income received by a person abroad and any remitted ring fenced foreign income|A|Country or territory code|text
SA106|All other income received by a person abroad and any remitted ring fenced foreign income|B|Amount of income arising or received before any tax taken off|money
SA106|All other income received by a person abroad and any remitted ring fenced foreign income|C|Foreign tax taken off or paid|money
SA106|All other income received by a person abroad and any remitted ring fenced foreign income|D|Special Withholding Tax and any UK tax taken off|money
SA106|All other income received by a person abroad and any remitted ring fenced foreign income|E|To claim Foreign Tax Credit Relief, put 'X' in the box|yesno
SA106|All other income received by a person abroad and any remitted ring fenced foreign income|F|Taxable amount|money
SA106|All other income received by a person abroad and any remitted ring fenced foreign income|12|Total foreign tax and Special Withholding Tax|money
SA106|All other income received by a person abroad and any remitted ring fenced foreign income|13|Total taxable amount|money
SA106|All other income received by a person abroad and any remitted ring fenced foreign income|13.0|Total claimed under the FIG regime|money|?
SA106|All other income received by a person abroad and any remitted ring fenced foreign income|13.1|Amount of residential property income or restricted finance costs associated with income in box 13, for calculating relief for residential finance costs|money
SA106|All other income received by a person abroad and any remitted ring fenced foreign income|13.2|Unused residential property finance costs brought forward|money
SA106|Income from land and property abroad – income and expenses|14|Total rents and other receipts, excluding taxable premiums for the grant of a lease|money
SA106|Income from land and property abroad – income and expenses|14.1|Property income allowance|money
SA106|Income from land and property abroad – income and expenses|14.2|If you've used traditional accounting rather than cash basis to calculate your income and expenses, put 'X' in the box|yesno
SA106|Income from land and property abroad – income and expenses|15|Number of overseas let properties|number
SA106|Income from land and property abroad – income and expenses|16|Premiums paid for the grant of a lease|money
SA106|Income from land and property abroad – income and expenses|17|Allowable property expenses – rent, repairs, legal fees, cost of services provided|money
SA106|Income from land and property abroad – income and expenses|18|Net profit or loss – if this is a loss put a minus sign in the box|money
SA106|Income from land and property abroad – income and expenses|19|Private use adjustment|money
SA106|Income from land and property abroad – income and expenses|20|Balancing charges|money
SA106|Income from land and property abroad – calculating profits and losses|21|Capital allowances for equipment and vehicles, but not for furnished residential lettings|money
SA106|Income from land and property abroad – calculating profits and losses|21.1|Zero-emission car allowance|money
SA106|Income from land and property abroad – calculating profits and losses|22.1|The Structures and Buildings Allowance|money
SA106|Income from land and property abroad – calculating profits and losses|22.2|Electric charge-point allowance|money
SA106|Income from land and property abroad – calculating profits and losses|23|Costs of replacing domestic items, for residential lettings only|money
SA106|Income from land and property abroad – calculating profits and losses|24|Adjusted profit or loss for the year|money
SA106|Income from land and property abroad – calculating profits and losses|24.1|Residential property finance costs|money
SA106|Income from land and property abroad – calculating profits and losses|24.2|Unused residential property finance costs brought forward|money
SA106|Summary of income from land and property abroad|25|Total adjusted profit or loss|money
SA106|Summary of income from land and property abroad|26|Total loss brought forward from earlier years|money
SA106|Summary of income from land and property abroad|27|Total taxable profits – if box 25 minus box 26 is a positive amount|money
SA106|Summary of income from land and property abroad|28|Total foreign tax|money
SA106|Summary of income from land and property abroad|29|Total foreign tax on which relief is claimed|money|?
SA106|Summary of income from land and property abroad|30|Total taxable amount|money|?
SA106|Summary of income from land and property abroad|30.1|Total claimed under the FIG regime|money|?
SA106|Summary of income from land and property abroad|31|Loss set off against total income|money
SA106|Summary of income from land and property abroad|32|Total loss to carry forward to the following year|money
SA106|Capital gains – Foreign Tax Credit Relief and Special Withholding Tax|33|Amount of chargeable gain under UK rules|money
SA106|Capital gains – Foreign Tax Credit Relief and Special Withholding Tax|34|Number of days over which UK gain accrued|number
SA106|Capital gains – Foreign Tax Credit Relief and Special Withholding Tax|35|Amount of chargeable gain under foreign tax rules|money
SA106|Capital gains – Foreign Tax Credit Relief and Special Withholding Tax|36|Number of days over which foreign gain accrued|number
SA106|Capital gains – Foreign Tax Credit Relief and Special Withholding Tax|37|Foreign tax paid|money
SA106|Capital gains – Foreign Tax Credit Relief and Special Withholding Tax|38|To claim Foreign Tax Credit Relief, put 'X' in the box|yesno
SA106|Capital gains – Foreign Tax Credit Relief and Special Withholding Tax|39|Total Foreign Tax Credit Relief on gains|money
SA106|Capital gains – Foreign Tax Credit Relief and Special Withholding Tax|40|Special Withholding Tax|money
SA106|Other overseas income and gains|43|Gains from foreign life insurance policies, capital redemption policies and life annuity contracts, excluding amounts entered in box 13 – the amount of the gain|money
SA106|Other overseas income and gains|44|Number of years|number
SA106|Other overseas income and gains|45|Tax treated as paid|money
SA106|Other overseas income and gains|46|If you've omitted income from boxes 11, 13 or 58 to 61 because you're claiming an exemption in relation to a transfer of assets, enter the total amount omitted|money
SA106|Other overseas income and gains|54|Discretionary income from non-settlor interested non-resident trusts|money
SA106|Other overseas income and gains|54.1|Total claimed under the FIG regime on discretionary income from non-settlor interested non-resident trusts|money
SA106|Other overseas income and gains|55|Capital sums paid to settlor by trustees of non-resident trusts|money
SA106|Other overseas income and gains|55.1|Total claimed under the FIG regime on capital sums paid to settlor by trustees of non-resident trusts|money
SA106|Other overseas income and gains|56|Gains on disposal of holdings in offshore funds, excluding amounts in box 13|money
SA106|Other overseas income and gains|56.1|Total claimed under the FIG regime on gains on disposal of holdings in offshore funds|money
SA106|Other overseas income and gains|57|Non-trade income, excluding amounts in box 13|money
SA106|Other overseas income and gains|57.1|Total claimed under the FIG regime on non-trade income|money
SA106|Other overseas income and gains|58|Benefits received by non-transferors from a person abroad in the year taxable under the Transfer of Assets Abroad (ToAA) legislation|money
SA106|Other overseas income and gains|58.1|Amount claimed under the FIG regime in respect of box 58|money
SA106|Other overseas income and gains|59|Benefits received by transferor in the year from a person abroad matched to Transitionally Protected Income (TPI) or Protected Foreign Source Income (PFSI) taxable under ToAA|money
SA106|Other overseas income and gains|59.1|Amount claimed under the FIG regime in respect of box 59|money
SA106|Other overseas income and gains|60|Benefits chargeable on you under the Close Family Member rules taxable under ToAA|money
SA106|Other overseas income and gains|60.1|Amount claimed under the FIG regime in respect of box 60|money
SA106|Other overseas income and gains|61|Benefits chargeable on you under the Onward Gifts rules taxable under ToAA|money
SA106|Other overseas income and gains|61.1|Amount claimed under the FIG regime in respect of box 61|money
SA106|Other overseas income and gains|62|Benefits received by settlor in the year from a settlement matched to Transitional Trust Income (TTI) or Protected Foreign Source Income (PFSI) taxable under the settlements legislation|money
SA106|Other overseas income and gains|62.1|Amount claimed under the FIG regime in respect of box 62|money
SA106|Other overseas income and gains|63|Benefits received by a close family member of the settlor in the year from a settlement matched to Transitional Trust Income (TTI) or Protected Foreign Source Income (PFSI) taxable under the settlements legislation|money
SA106|Other overseas income and gains|63.1|Amount claimed under the FIG regime in respect of box 63|money
SA106|Other overseas income and gains|64|Benefits chargeable on you under the Onward Gifts rules taxable under the settlements legislation|money
SA106|Other overseas income and gains|64.1|Amount claimed under the FIG regime in respect of box 64|money
SA106|Non-savings income arising in non-resident settlor interested trusts|A|Country or territory code|text
SA106|Non-savings income arising in non-resident settlor interested trusts|B|Amount of income arising or received before any tax taken off|money
SA106|Non-savings income arising in non-resident settlor interested trusts|C|Foreign tax taken off or paid|money
SA106|Non-savings income arising in non-resident settlor interested trusts|D|Special Withholding Tax and any UK tax taken off|money
SA106|Non-savings income arising in non-resident settlor interested trusts|E|To claim Foreign Tax Credit Relief, put 'X' in the box|yesno
SA106|Non-savings income arising in non-resident settlor interested trusts|F|Taxable amount|money
SA106|Non-savings income arising in non-resident settlor interested trusts|47|Total foreign tax and Special Withholding Tax|money|?
SA106|Non-savings income arising in non-resident settlor interested trusts|48|Total taxable amount|money|?
SA106|Non-savings income arising in non-resident settlor interested trusts|48.1|Total claimed under the FIG regime|money
SA106|Non-savings income arising in non-resident settlor interested trusts|49|Amount of overseas residential property income or restricted finance costs for the non-resident trust, for relief for residential finance costs|money
SA106|Non-savings income arising in non-resident settlor interested trusts|49.1|Unused overseas residential property finance costs brought forward in relation to box 48|money
SA106|Savings income arising in non-resident settlor interested trusts|A|Country or territory code|text
SA106|Savings income arising in non-resident settlor interested trusts|B|Amount of income arising or received before any tax taken off|money
SA106|Savings income arising in non-resident settlor interested trusts|C|Foreign tax taken off or paid|money
SA106|Savings income arising in non-resident settlor interested trusts|50|Total foreign tax|money|?
SA106|Savings income arising in non-resident settlor interested trusts|51|Total taxable amount|money|?
SA106|Savings income arising in non-resident settlor interested trusts|51.1|Total claimed under the FIG regime|money
SA106|Dividend income arising in non-resident settlor interested trusts|A|Country or territory code|text
SA106|Dividend income arising in non-resident settlor interested trusts|B|Amount of income arising or received before any tax taken off|money
SA106|Dividend income arising in non-resident settlor interested trusts|C|Foreign tax taken off or paid|money
SA106|Dividend income arising in non-resident settlor interested trusts|52|Total foreign tax|money|?
SA106|Dividend income arising in non-resident settlor interested trusts|53|Total taxable amount|money|?
SA106|Dividend income arising in non-resident settlor interested trusts|53.1|Total claimed under the FIG regime|money
SA106|Foreign tax paid on employment, self-employment and other income|A|Country or territory code|text
SA106|Foreign tax paid on employment, self-employment and other income|C|Foreign tax paid|money
SA106|Foreign tax paid on employment, self-employment and other income|E|To claim Foreign Tax Credit Relief, put 'X' in the box|yesno
SA106|Foreign tax paid on employment, self-employment and other income|F|Taxable amount|money
# --- SA109 residence and the FIG regime -------------------------------------
SA109|Residence status|1|If you were not resident in the UK for 2025–26, put 'X' in the box|yesno
SA109|Residence status|3|If your circumstances meet the criteria for split year treatment for 2025–26, put 'X' in the box|yesno
SA109|Residence status|3.1|If more than one case of split year treatment applies, put 'X' in the box|yesno
SA109|Residence status|4|If you were resident in the UK for 2024–25, put 'X' in the box|yesno
SA109|Residence status|6|If you have an entry in box 3, enter the date from which the UK part of the year begins or ends|date
SA109|Residence status|7|If you meet the third automatic overseas test, put 'X' in the box|yesno
SA109|Residence status|8|If you had a gap between employments in 2025–26, put 'X' in the box|yesno
SA109|Residence status|9|If you had a home overseas in 2025–26, put 'X' in the box|yesno
SA109|Residence status|10|Number of days spent in the UK during 2025–26|number
SA109|Residence status|11|Number of days in box 10 attributed to exceptional circumstances|number
SA109|Residence status|11.1|Number of days when you were in the UK at midnight during 2025–26 but you were in transit – do not include these days in box 10|number
SA109|Residence status|12|How many ties to the UK did you have in 2025–26?|number
SA109|Residence status|13|Number of days you worked for more than 3 hours in the UK in 2025–26|number
SA109|Residence status|14|Number of days you worked for more than 3 hours overseas in 2025–26|number
SA109|Personal allowances for non-residents and dual residents|15|If you're entitled to claim personal allowances as a non-resident because of the terms of a Double Taxation Agreement, put 'X' in the box|yesno
SA109|Personal allowances for non-residents and dual residents|16|If you're entitled to claim personal allowances as a non-resident on some other basis, or as a dual resident remittance basis user under the terms of certain Double Taxation Agreements, put 'X' in the box|yesno
SA109|Personal allowances for non-residents and dual residents|17|Enter the codes for the country or countries of which you're a national and/or resident|text
SA109|Personal allowances for non-residents and dual residents|18|Enter the codes for the country or countries, other than the UK, in which you were resident for tax purposes for 2025–26|text
SA109|Personal allowances for non-residents and dual residents|19|If you were also resident in either or both of the countries above for 2024–25, enter the appropriate codes|text
SA109|Personal allowances for non-residents and dual residents|20|Amount of Double Taxation Agreement income for which partial relief is being claimed|money
SA109|Personal allowances for non-residents and dual residents|21|Relief under Double Taxation Agreements between the UK and other countries – amount claimed because of an agreement awarding residence to another country|money
SA109|Personal allowances for non-residents and dual residents|22|Relief claimed because of other provisions of the relevant Double Taxation Agreements|money
SA109|Residence in other countries|23|What was your date of arrival in the UK|date
SA109|Residence in other countries|24|If you were UK resident in a tax year prior to your most recent arrival, enter the year|text
SA109|Foreign income and gains (FIG) regime|28|If you're making a claim for relief on foreign income under the FIG regime, put 'X' in the box|yesno
SA109|Foreign income and gains (FIG) regime|29|If you're making a claim for relief on foreign gains under the FIG regime, put 'X' in the box|yesno
SA109|Foreign income and gains (FIG) regime|30|If you have UK income or gains deemed to be foreign under qualifying asset holding company rules, put 'X' in the box|yesno
SA109|Remittance basis for foreign income and gains prior to 6 April 2025|37|If you have remitted nominated income or gains during this tax year, put 'X' in the box unless what you have remitted is within the £10 aggregate limit|yesno
SA109|Remittance basis for foreign income and gains prior to 6 April 2025|38|If you're claiming relief from UK tax for foreign income or gains invested in a qualifying business, enter the total amount invested|money
SA109|Remittance basis for foreign income and gains prior to 6 April 2025|39|If you have previously claimed relief for a qualifying investment and the investment no longer qualifies for relief, put 'X' in the box|yesno
SA109|Overseas Workday Relief (OWR)|40|If you're making an election for Overseas Workday Relief, put 'X' in the box|yesno
SA109|Overseas Workday Relief (OWR)|41|If you're making a claim for Overseas Workday Relief, put 'X' in the box|yesno
SA109|Overseas Workday Relief (OWR)|43|If you qualify for the OWR transitional provisions in any year for which you're making a claim, put 'X' in the box|yesno
SA109|Overseas Workday Relief (OWR)|44|Qualifying employment income after deductions|money
SA109|Overseas Workday Relief (OWR)|46|Qualifying foreign employment income after deductions|money
SA109|Overseas Workday Relief (OWR)|47|Maximum relief available under the financial limit|money
SA109|Overseas Workday Relief (OWR)|48|OWR claimed on the qualifying employment income|money
SA109|Overseas Workday Relief (OWR)|49|If you're making one or more claims for OWR, put the total amount of relief claimed for this tax year|money
SA109|Temporary repatriation facility (TRF)|50|If you're making an election under the TRF, put 'X' in the box|yesno
SA109|Temporary repatriation facility (TRF)|51|Amount that relates to personal TRF designations|money
SA109|Temporary repatriation facility (TRF)|52|Amount that relates to capital payments and benefits received from trusts|money
SA109|Temporary repatriation facility (TRF)|53|Amount of TRF designations remitted in this tax year|money
SA109|Any other information|54|Please give any other information in this space|text
`;

/** Every SA page, in HMRC's order, with its sections and boxes. */
/**
 * HMRC's order, which is not the order the spec above happens to be written in.
 * The spec grew page by page as each was researched; the tab strip should read
 * the way the return does.
 */
const ORDER = [
  'SA100', 'SA101', 'SA102', 'SA103S', 'SA103F', 'SA104S',
  'SA104F', 'SA105', 'SA106', 'SA107', 'SA108', 'SA109',
];

export const SA_PAGES: Page[] = parse(SPEC)
  .sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code));

const BY_CODE = new Map(SA_PAGES.map((p) => [p.code, p]));

export const saPage = (code: string): Page | undefined => BY_CODE.get(code);

const BY_KEY = new Map<string, { page: Page; section: Section; box: Box }>();
for (const page of SA_PAGES) {
  for (const section of page.sections) {
    for (const box of section.boxes) {
      if (BY_KEY.has(box.key)) {
        throw new Error(`Duplicate SA box key: ${box.key}`);
      }
      BY_KEY.set(box.key, { page, section, box });
    }
  }
}

/** Find a box by its storage key. Undefined for a key from an older schema. */
export const saBox = (key: string) => BY_KEY.get(key);

/** The key a box is stored under, without having to remember the slug rule. */
export const saKey = (page: string, section: string, box: string) =>
  `${page}.${slug(section)}.${box}`;

export const SA_BOX_COUNT = BY_KEY.size;
