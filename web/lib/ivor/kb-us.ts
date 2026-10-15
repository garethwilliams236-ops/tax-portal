/**
 * IVOR — the United States, for a US citizen living in the UK.
 *
 * Written for a reader who is not an accountant. Every topic carries a
 * `plain` version — short paragraphs, everyday words, each term explained —
 * which is what she sees first at the plain level. The technical fields
 * (`what`, `detail`, `judgement`, `cites`) are kept for checking, and for the
 * technical level.
 *
 * Figures come from lib/tax/us/rates.ts, the same table the US return screen
 * computes with, so an explanation cannot drift from the calculation. US tax
 * years are calendar years; where a figure differs by year, both held years
 * are given.
 *
 * Verified against irs.gov on 9 and 15 October 2026.
 */

import type { Topic } from './kb';
import {
  usRates, US_YEARS_HELD, NIIT_THRESHOLD, FBAR_THRESHOLD, FORM_8938_ABROAD,
  CTC_PHASEOUT, FILING_STATUS_LABEL,
} from '@/lib/tax/us/rates';

const usd = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
const byYear = (f: (y: number) => number) => US_YEARS_HELD.map((y) => `${usd(f(y))} for ${y}`).join(' and ');
const feie = () => byYear((y) => usRates(y).feie);
const stdMfs = () => byYear((y) => usRates(y).standardDeduction.mfs);
const stdHoh = () => byYear((y) => usRates(y).standardDeduction.hoh);
const ctc = () => usd(usRates(US_YEARS_HELD[US_YEARS_HELD.length - 1]!).childTaxCredit);
const actc = () => usd(usRates(US_YEARS_HELD[US_YEARS_HELD.length - 1]!).childTaxCreditRefundable);
const latest = () => US_YEARS_HELD[US_YEARS_HELD.length - 1]!;

const V1009 = '2026-10-09';
const V1015 = '2026-10-15';

// ---------------------------------------------------------------------------
// Plain versions of the topics already in the main table
// ---------------------------------------------------------------------------

export const US_PLAIN: Record<string, string[] | (() => string[])> = {
  'us-filing-status': () => [
    'Your "filing status" is the category you file under. It decides how wide your tax bands are and how big your standard deduction is (the amount you can earn before US tax starts).',
    `Because your husband is not American, the US treats you as married but filing on your own. So the normal choice is "${FILING_STATUS_LABEL.mfs}". That is the safe default.`,
    `If you have a child living with you, you may be able to file as "${FILING_STATUS_LABEL.hoh}" instead. This is usually better: the standard deduction is ${stdHoh()}, against ${stdMfs()} for married filing separately, and the tax bands are wider. The US rules let you use it because a non-American husband is ignored for this purpose.`,
    `"${FILING_STATUS_LABEL.mfj}" is only possible if you both choose to treat your husband as a US taxpayer. That brings all of his income — his salary and the company dividends — into the US return. It is rarely worth it and is hard to undo, so do not choose it without proper advice.`,
    'On the US return screen, pick the status at the top. You can try each one and save to see how the result changes.',
  ],
  'us-feie-ftc': () => [
    'The US taxes its citizens wherever they live, but it does not want you to pay tax twice on the same income. There are two ways to stop that happening, and you choose between them.',
    `Option 1 — the "foreign earned income exclusion" (Form 2555). You leave your UK earnings out of the US return completely, up to ${feie()}. It only covers earnings from work — not interest, dividends, rent or pensions.`,
    'Option 2 — the "foreign tax credit" (Form 1116). You include your UK income, work out the US tax on it, then take off the UK tax you have already paid on that same income. Because UK tax is usually higher than US tax, this normally brings the US tax down to nothing.',
    'For most people with a UK salary, Option 2 works out at least as well, and it has two big advantages: unused UK tax can be carried forward to later years, and — if you have children — it keeps the child tax credit refund open (see "child tax credit"). The exclusion blocks that refund.',
    'One warning: if you start using the exclusion and later stop, you cannot use it again for five years without IRS permission. So decide carefully. On the screen you can tick and untick "Claim on Form 2555" and save each time to compare the result.',
  ],
  'us-niit': () => [
    'The "net investment income tax" is an extra 3.8% US tax on investment income — interest, dividends, gains and rent — but only for people with high incomes.',
    `For married filing separately it only starts once your total income is over ${usd(NIIT_THRESHOLD.mfs)} (${usd(NIIT_THRESHOLD.single)} for single or head of household). Most people never pay it.`,
    'The catch for people living abroad: UK tax paid cannot normally be set against it, so even if the foreign tax credit wipes out your ordinary US tax, this one can still be due. The screen works it out for you if it applies.',
  ],
  'us-fbar-8938': () => [
    `The FBAR is a form telling the US Treasury about your non-US bank and savings accounts. You must file it if all your non-US accounts added together were worth more than ${usd(FBAR_THRESHOLD)} at any moment in the year. Almost everyone living in the UK has to file one.`,
    'It counts every account in your name, accounts you hold jointly with your husband, ISAs, savings accounts, and accounts you can sign on even if the money is not yours — such as a company bank account if you are a signatory.',
    'It is filed online through the "BSA E-Filing" website, separately from the tax return. It is due on 15 April and automatically extended to 15 October, so you do not need to ask. There is no tax to pay on it — it is just a report. But the penalties for not filing can be large, so do not skip it.',
    `Form 8938 is a similar list, filed with the tax return itself, but only when your foreign assets are much larger: for someone living abroad, over ${usd(FORM_8938_ABROAD.mfs.yearEnd)} on 31 December or over ${usd(FORM_8938_ABROAD.mfs.anyTime)} at any time (married filing separately or single).`,
    'On the screen, enter the highest combined balance of your accounts during the year and the screen tells you whether either form is needed.',
  ],
  'us-deadlines': () => [
    'The US tax year is the calendar year, January to December. The return for a year is due the following spring.',
    'Because you live outside the US, you automatically get until 15 June to file — you just attach a short note saying you lived abroad. If you need longer, you can file Form 4868 by 15 June to get until 15 October.',
    'Important: those extensions are for sending the return, not for paying. If you owe any US tax, interest is charged from 15 April. If you expect to owe nothing — which is common for people paying UK tax — this does not matter.',
    'The FBAR (the bank account report) is due 15 April and is automatically extended to 15 October.',
    'Your deadlines are listed on the US return screen and appear in the to-do list. Once you enter the date you filed, the reminder disappears.',
  ],
  'us-screen': () => [
    'The US return screen works one calendar year at a time. Pick the year at the top.',
    'On the left you type in your figures. You can type them in pounds — the screen converts them using the exchange rate you enter for the year. US tax withheld and US payments are always typed in dollars.',
    'On the right you see the US tax return that your figures produce, line by line, with a short explanation under each line. Nothing is stored except what you typed, so if a figure is corrected, everything updates.',
    'Leave a box blank if it does not apply to you. Blank means "nothing to enter".',
    'To compare the two ways of avoiding double tax, save once with "Claim on Form 2555" ticked and once without, and look at the "Amount owed" or "Refund due" line each time.',
    'At the bottom there is a list of things the screen does not work out. If any of them applies to you, that part needs checking by hand.',
  ],
  'us-pfic': () => [
    'This is one of the nastiest traps for Americans in the UK. Most UK investment funds — the pooled funds sold by UK fund managers and platforms (unit trusts and OEICs), investment trusts, and exchange-traded funds (ETFs) listed in London — count as a "PFIC" (passive foreign investment company) for the US. Shares in a single ordinary company are not.',
    'The US taxes PFICs very harshly: gains can be taxed at the top rate with an interest charge on top, and each fund needs its own form (Form 8621). It does not matter that the fund is inside an ISA — the US ignores the ISA wrapper.',
    'Cash ISAs and savings accounts are not a problem in the same way: the interest is simply taxable in the US like any other interest.',
    'If you hold, or are thinking of buying, UK funds, speak to a US tax preparer first. Many Americans in the UK hold individual shares or US-based funds instead. This screen does not calculate PFIC tax.',
  ],
  'us-se-tax': () => [
    'The US has its own version of National Insurance, called self-employment tax, for people who work for themselves.',
    'If you are employed in the UK and pay National Insurance through your payslip, you do not pay US social security tax on that pay. The two countries have an agreement (the "totalization agreement") so you only pay into one system.',
    'If you are self-employed and live in the UK, the same agreement normally means you pay UK National Insurance and not US self-employment tax — but you have to prove it by attaching a certificate of UK coverage from HMRC to your US return.',
    'This screen does not calculate US self-employment tax.',
  ],
};

// ---------------------------------------------------------------------------
// New topics, written for the plain level first
// ---------------------------------------------------------------------------

export const US_TOPICS: Topic[] = [
  {
    id: 'us-why-file', t: 'Why Americans in the UK file every year',
    tags: 'us usa why file american citizen live lives living abroad expat worldwide income every year citizenship based taxation americans abroad',
    plain: [
      'The United States is one of very few countries that taxes its citizens wherever they live. So even though you live and pay tax in the UK, as a US citizen you are expected to file a US tax return every year.',
      'Filing does not usually mean paying. Most Americans in the UK owe little or no US tax, because the UK tax they have already paid is taken off (or their UK earnings are left out). But you still have to file to claim that.',
      'Each year there are normally two things to do: the tax return (Form 1040) and, separately, the bank account report (the FBAR).',
      'If you have missed years, there is an official catch-up route that waives penalties where the failure was not deliberate — ask Ivor about "catching up on missed years".',
    ],
    what: 'US citizens are taxed on worldwide income regardless of residence (IRC s.1; Treas. Reg. 1.1-1(b)). A UK-resident citizen files Form 1040 annually where gross income meets the filing threshold, and relieves double tax through the exclusion (s.911) or the foreign tax credit (s.901), both of which require a return.',
    detail: [
      'The FBAR (FinCEN 114) is a separate annual report under the Bank Secrecy Act, not part of the return.',
      'The US–UK treaty saving clause (Art. 1(4)) preserves US taxation of its citizens, subject to listed exceptions such as pensions and social security.',
    ],
    cites: [['Treas. Reg. 1.1-1(b)', 'Citizens taxed wherever resident'], ['US–UK Income Tax Treaty Art. 1(4)', 'Saving clause']],
    verified: V1015,
  },
  {
    id: 'us-need-to-file', t: 'Do I need to file a US return this year?',
    tags: 'us usa need to file have to file required filing threshold gross income how much income must file return married filing separately 5',
    plain: () => [
      'Probably yes. For married filing separately — the usual status for an American married to a Brit — you must file if your income for the year was $5 or more. Not $5,000: five dollars.',
      `For other statuses the line is higher (roughly the standard deduction — for example ${stdHoh()} for head of household), but "income" here includes UK earnings even if you plan to exclude them.`,
      'Even when you are not strictly required to file, filing can be worthwhile: it can get you the child tax credit refund if you have children, and it keeps your record clean.',
      'The FBAR (bank account report) has its own test: file it if your non-US accounts added together went over $10,000 at any time in the year.',
    ],
    what: 'IRS Publication 501, Table 1: a married taxpayer filing separately must file if gross income is $5 or more, at any age. For other statuses the threshold is broadly the standard deduction. Gross income for this test includes foreign earned income that will be excluded.',
    cites: [['IRS Publication 501 (2025), Table 1', 'Filing requirements'], ['IRC s.6012(a)(1)', 'Persons required to make returns']],
    verified: V1015,
  },
  {
    id: 'us-getting-started', t: 'Getting started: what to gather for the US return',
    tags: 'us usa start getting started where begin first steps checklist documents gather need prepare p60 payslips statements what do i need',
    plain: [
      'Here is the order that makes the US return easiest.',
      '1. Choose the year. US years run January to December, not April to April. Start with the most recent year that has not been filed.',
      '2. Gather your pay for January to December. Your P60 covers the UK tax year (April to April), so it will not match. The simplest way is to add up your twelve monthly payslips from January to December — gross pay, and the income tax deducted.',
      '3. Gather interest, dividends and rent for January to December. Bank statements show interest by month. Dividend vouchers from the companies show the date each dividend was paid.',
      '4. Work out the UK tax. For pay, it is the income tax on your January–December payslips. For tax you pay through Self Assessment, the normal US rule is to count it in the calendar year you actually paid it. (There is an election to count it by UK tax year instead; once made it applies every year, so ask before choosing it.)',
      '5. Note the highest balance of each non-US account during the year, and the balance on 31 December. You need this for the FBAR.',
      '6. Find the exchange rate. The IRS publishes a yearly average pounds-to-dollars rate; enter that once on the screen and type your figures in pounds.',
      '7. Count your qualifying days abroad (usually the whole year if you lived in the UK all year) and how many children under 17 have a US Social Security number.',
      'Then fill in the US return screen, save it, and read the result line by line. Ask Ivor about any line you are not sure of.',
    ],
    what: 'Inputs for a calendar-year Form 1040 for a UK resident: January–December earnings and UK tax withheld (from payslips, not the P60), investment income by payment date, UK tax attributable to each category, account maxima and year-end values for FBAR and Form 8938, an exchange rate, qualifying days for s.911, and qualifying children with SSNs for s.24.',
    detail: [
      'The IRS accepts its published yearly average exchange rate for income received evenly through the year; actual spot rates may be used for specific transactions.',
      'Creditable UK tax follows the taxpayer\'s method: paid (cash, the default) or accrued at the end of the UK tax year (s.905(a) election, binding thereafter).',
    ],
    cites: [['IRS', 'Yearly average currency exchange rates'], ['IRS Publication 54', 'Tax Guide for U.S. Citizens and Resident Aliens Abroad']],
    verified: V1015,
  },
  {
    id: 'us-tax-year', t: 'UK tax year and US tax year are different',
    tags: 'us usa tax year calendar year april january december p60 different years split convert uk tax year payslips which year',
    plain: [
      'The UK tax year runs from 6 April to 5 April. The US tax year is simply January to December. So one US year takes three months from one UK tax year and nine months from the next.',
      'Example: the US year 2025 is made up of January–March 2025 (the end of the UK 2024/25 year) and April–December 2025 (the start of the UK 2025/26 year).',
      'This is why your P60 cannot be copied straight onto the US return. Use your payslips for January to December instead, or your December payslip\'s year-to-date figures plus January to March from the previous year.',
      'For UK tax: take the income tax deducted on those same January–December payslips. Tax you pay through Self Assessment normally counts in the US year in which you paid it — for example, a payment made on 31 January 2026 counts in 2026.',
      'There is an alternative — an election to count UK tax by the UK tax year it belongs to (each UK year\'s tax then counts in the US year in which that UK year ends). Once made, it applies to every later year, so take advice before choosing it.',
    ],
    what: 'US individuals use the calendar year (IRC s.441). UK income tax years run 6 April–5 April. Income is taken from the months within the calendar year. A cash-method taxpayer claims foreign tax in the year paid (PAYE when withheld); one who elects the accrual method under s.905(a) takes UK tax into account on the last day of the UK tax year (Reg. 1.905-1(d)), and the election binds later years.',
    cites: [['IRC s.441', 'Taxable year'], ['IRC s.905(a)', 'Election to credit foreign taxes when accrued'], ['Treas. Reg. 1.905-1', 'When foreign taxes are taken into account']],
    verified: V1015,
  },
  {
    id: 'us-exchange-rate', t: 'Turning pounds into dollars',
    tags: 'us usa exchange rate currency convert pounds dollars gbp usd yearly average rate which rate',
    plain: [
      'The US return is in dollars, so every pound figure has to be converted.',
      'For income received through the year — salary, interest — the IRS accepts its own published yearly average exchange rate. Enter that rate once on the US return screen (as "$ per £1", for example 1.28) and type your figures in pounds. The screen does the conversion and shows the rate it used.',
      'For a one-off event, such as selling shares or a property, the exchange rate on the day is more accurate. If you have one of those, convert that figure yourself and keep a note of the rate.',
      'Use the same method every year.',
    ],
    what: 'Amounts are translated into US dollars; the IRS publishes yearly average rates acceptable for items received evenly over the year, with spot rates for discrete transactions. A consistent method should be applied.',
    cites: [['IRC s.985–989', 'Functional currency and translation'], ['IRS', 'Yearly average currency exchange rates']],
    verified: V1015,
  },
  {
    id: 'us-income-types', t: 'What income goes on the US return',
    tags: 'us usa income what goes report include salary interest isa dividends rent pension capital gains qualified dividends company dividends',
    plain: [
      'Everything goes on the US return — all your income from anywhere in the world. The main types, and where they go on the screen:',
      'Pay from work (salary, director\'s fees, bonuses): "Earnings abroad".',
      'Bank and savings interest, including interest in cash ISAs: "Interest". The US does not recognise ISAs as tax-free.',
      'Dividends, including dividends from your husband\'s companies if you hold shares: "Dividends (all)". UK company dividends are usually "qualified", which means they are taxed at lower US rates — enter them again in "of which qualified".',
      'Profits from selling shares or other investments: "Short-term gains" if you held them a year or less, otherwise "Long-term gains" (taxed at lower rates).',
      'Rent from property, after expenses: "Net rental income". US rules on what you can deduct are different from the UK — in particular the US makes you deduct "depreciation", a yearly allowance for wear and tear on the building — so this figure will usually not match your UK one.',
      'Pensions you are receiving: "Pensions". Ask Ivor about UK pensions for how the treaty treats them.',
    ],
    what: 'Gross income includes all income from whatever source (IRC s.61). Dividends from a UK company eligible for the US–UK treaty are qualified dividends taxed at s.1(h) rates if holding-period conditions are met. UK ISAs have no US recognition; income and gains inside them are taxable currently.',
    detail: [
      'Qualified dividend: s.1(h)(11); a UK company is a qualified foreign corporation by virtue of the comprehensive income tax treaty (Notice 2011-64 lists the treaties).',
      'Long-term means held more than one year (s.1222).',
    ],
    cites: [['IRC s.61', 'Gross income'], ['IRC s.1(h)(11)', 'Qualified dividends'], ['Notice 2011-64', 'Treaties for qualified foreign corporations']],
    verified: V1015,
  },
  {
    id: 'us-deduction-brackets', t: 'The standard deduction and US tax bands',
    tags: 'us usa standard deduction tax bands brackets rates how much tax 10% 12% 22% 24% personal allowance itemize',
    plain: () => {
      const r = usRates(latest());
      const b = r.brackets.mfs;
      return [
        'The "standard deduction" is the US version of the personal allowance: an amount of income that is not taxed at all. You take it automatically unless your itemised deductions (things like mortgage interest on a US home or charitable gifts) are bigger — which is rare for someone living in the UK.',
        `For ${latest()}, married filing separately: ${usd(r.standardDeduction.mfs)}. Head of household: ${usd(r.standardDeduction.hoh)}.`,
        `After that, US tax goes up in bands, like UK tax. For ${latest()}, married filing separately: 10% on the first ${usd(b[0]!)}, 12% up to ${usd(b[1]!)}, 22% up to ${usd(b[2]!)}, 24% up to ${usd(b[3]!)}, then 32%, 35% and 37% above that.`,
        'Qualified dividends and long-term gains are taxed at lower rates — 0%, 15% or 20% — depending on total income.',
        'For most people living in the UK, the credit for UK tax then reduces this US tax to nothing.',
      ];
    },
    what: 'Taxable income is AGI less the greater of the standard deduction (s.63(c)) and itemised deductions, taxed under the s.1(j) rate schedule for the filing status, with qualified dividends and net capital gain taxed at 0/15/20% (s.1(h)).',
    cites: [['IRC s.63', 'Standard deduction'], ['IRC s.1(j)', 'Rate schedules 2018 onwards'], ['Rev. Proc. 2024-40; Rev. Proc. 2025-32', 'Inflation adjustments']],
    verified: V1015,
  },
  {
    id: 'us-ctc', t: 'The child tax credit for Americans abroad',
    tags: 'us usa child tax credit ctc additional actc refund refundable children kids money back 8812 cash dependents',
    plain: () => [
      `If you have children under 17 who have a US Social Security number, you can claim up to ${ctc()} per child off your US tax.`,
      `This matters even if you owe no US tax. Part of the credit — up to ${actc()} per child — can be paid to you in cash by the IRS as a refund. This is the "additional child tax credit". For an American family in the UK it can be worth thousands of dollars a year.`,
      'The refund is limited to 15% of your earnings above $2,500, so you need earned income (a salary, for example) to get it.',
      'The big catch: if you use the foreign earned income exclusion (Form 2555), you cannot get the cash refund at all. That is one of the main reasons people with children usually choose the foreign tax credit instead.',
      'You also need your own Social Security number on the return, and each child needs one too. The child\'s number must be issued by the return\'s due date (15 June for you, or 15 October if you extend). A number obtained after that does not count for that year, even if the return is sent later.',
      'On the US return screen, enter the number of qualifying children. The result shows the credit and any refund.',
    ],
    what: () => `s.24: up to ${ctc()} per qualifying child under 17 with an SSN valid for employment; refundable portion (ACTC) up to ${actc()} per child, limited to 15% of earned income above $2,500. The credit phases out by $50 per $1,000 of modified AGI over ${usd(CTC_PHASEOUT.mfs)} (${usd(CTC_PHASEOUT.mfj)} joint). A taxpayer who files Form 2555 cannot claim the ACTC.`,
    detail: [
      'The non-refundable credit is limited to income tax after the foreign tax credit; the unused balance is what becomes refundable, subject to the caps.',
      'Modified AGI for the phase-out adds back excluded foreign earned income (s.24(b)(1)).',
      'The taxpayer must also have an SSN, a requirement added by P.L. 119-21.',
    ],
    cites: [['IRC s.24', 'Child tax credit'], ['Schedule 8812 instructions', '"If you file Form 2555, you cannot claim the additional child tax credit."'], ['Rev. Proc. 2025-32 s.4.05', `${latest()} amounts`]],
    verified: V1015,
  },
  {
    id: 'us-uk-pensions', t: 'UK pensions on the US return',
    tags: 'us usa uk pension workplace pension sipp contributions growth lump sum 25% tax free treaty article 17 18 auto enrolment state pension',
    plain: [
      'The US–UK tax treaty has special rules for pensions, and they generally help.',
      'Paying into a UK workplace pension: the treaty generally lets you treat it like a US retirement plan, so contributions and the growth inside the pension are not taxed by the US each year.',
      'The UK State Pension, when you receive it, is generally taxed only in the UK.',
      'Taking money out of a private or workplace pension: generally taxable in the US as well, with credit for any UK tax. The UK 25% tax-free lump sum is the area of most disagreement — some advisers treat it as tax-free in the US too under the treaty, others say it is taxable. Take advice before you draw it.',
      'Self-invested pensions (SIPPs) and how the treaty applies to each pension depend on the details. If you have UK pensions, this is worth checking with a US tax preparer once.',
    ],
    what: 'US–UK treaty Art. 17 (pensions) and Art. 18 (pension schemes) generally defer US tax on contributions to and accretions within a UK pension scheme for a UK-resident US citizen, and allocate UK social security to the UK. Distributions are generally taxable in the US with foreign tax credit relief.',
    judgement: 'The US treatment of the UK pension commencement lump sum is contested: one reading of Art. 17(2) exempts it in the US as it is exempt in the UK; the competing view is that the saving clause preserves US tax on citizens. Positions taken under a treaty may need Form 8833 disclosure. The portal records the pension figure you enter and does not take a position.',
    cites: [['US–UK Income Tax Treaty Arts. 17, 18', 'Pensions and pension schemes'], ['Form 8833', 'Treaty-based return position disclosure']],
    verified: V1015,
  },
  {
    id: 'us-uk-company', t: 'Shares in, or being a director of, a UK company',
    tags: 'us usa uk company shares director officer 5471 cfc controlled foreign corporation gilti family company limited company shareholder husband company',
    plain: [
      'If you own shares in a UK company, or are a director of one, the US has extra reporting rules. They are mostly about forms, not tax — but the penalties for missing them are $10,000 per form, so they matter.',
      'Form 5471 is the main one. It is triggered by shares changing hands: you file it for a year in which you reach (or drop below) 10% of a company\'s shares, and — as a director — for a year in which 10% or more is acquired.',
      'Be careful with a family company: for those "shares changing hands" tests, the US counts your husband\'s shares as if they were yours. So if he buys or is issued shares in a company you are a director or shareholder of, you may have to file Form 5471 even though you bought nothing yourself.',
      'There is a separate, bigger test: whether the company is a "controlled foreign corporation" — more than half owned by Americans who each hold at least 10%. If it is, Form 5471 is needed every year and the US can tax some of the company\'s profits even if nothing is paid out to you. For THIS test, your husband\'s shares are not counted as yours, because he is not American. Only your own shares count.',
      'Dividends you receive from the company go on the US return as ordinary income — usually "qualified" dividends, taxed at the lower rates.',
      'If you are a director or shareholder of any UK company — including your husband\'s — check each year whether shares changed hands, and whether Form 5471 applies, before filing. The screen does not prepare it.',
    ],
    what: 'Form 5471 (IRC s.6038, s.6046): Category 2 — a US citizen officer or director of a foreign corporation in which a US person acquired stock meeting the 10% test (or an additional 10%) in the year; Category 3 — a US person acquiring stock meeting the 10% test, or disposing below it; Categories 4/5 — control of, or US-shareholder status in, a controlled foreign corporation. Penalties: $10,000 per foreign corporation per period for Category 2 and 3 failures (s.6679); $10,000 per annual accounting period for s.6038 failures (s.6038(b)).',
    detail: [
      'For Categories 2 and 3, s.6046(c) treats an individual as owning stock owned by family, including a spouse, with no carve-out for a non-resident alien spouse; the spouse\'s acquisitions can therefore trigger filing.',
      'For CFC status and US-shareholder status (Categories 4 and 5), constructive ownership under s.958(b) imports s.318, but s.958(b)(1) provides that stock owned by a non-resident alien individual is not treated as owned by a US citizen under s.318(a)(1)(A).',
      'A CFC is a foreign corporation more than 50% owned (vote or value) by US shareholders, each owning 10% or more (s.957, s.951(b)).',
    ],
    cites: [['IRC s.6038, s.6046', 'Information returns for foreign corporations'], ['IRC s.6046(c)', 'Family attribution for Categories 2 and 3'], ['IRC s.958(b)(1)', 'No attribution from a non-resident alien to a citizen for CFC tests'], ['IRC s.6679', 'Penalty for Category 2 and 3 failures'], ['Instructions for Form 5471', 'Categories of filer; penalties']],
    verified: V1015,
  },
  {
    id: 'us-gifts-spouse', t: 'Gifts and money between you and your husband',
    tags: 'us usa gift gifts spouse husband transfer money wife 3520 foreign gift non citizen spouse annual exclusion inheritance bequest',
    plain: () => [
      'Money or property your husband gives you is a "gift from a foreign person" for US purposes, because he is not American. There is no US tax on receiving it, but if his gifts to you add up to more than $100,000 in a calendar year, you must report them on Form 3520. Transferring a share of a house or a large sum of money can easily cross that line.',
      'Form 3520 is due on the same date as your tax return (15 April, extended along with it), but it is sent separately. Missing it can bring a penalty of up to a quarter of the gift, so keep a note of large transfers.',
      `Gifts the other way — from you to your husband — have their own limit because he is not a US citizen: ${byYear((y) => (y === 2025 ? 190_000 : 194_000))} a year before you need to file a US gift tax return.`,
      'Everyday household spending is not what this is about. Large transfers — a lump sum, a share of a property, shares in a company — are what to watch.',
    ],
    what: 'IRC s.6039F: a US person receiving gifts or bequests from a non-resident alien individual exceeding $100,000 in aggregate in a taxable year reports them on Form 3520, due on the income tax return due date. Gifts by a US citizen to a non-citizen spouse qualify for an increased annual exclusion under s.2523(i)(2): $190,000 for 2025 and $194,000 for 2026.',
    cites: [['IRC s.6039F', 'Foreign gifts'], ['IRC s.2523(i)', 'Gifts to a non-citizen spouse'], ['Rev. Proc. 2024-40 s.2.43; Rev. Proc. 2025-32', 'Annual exclusion amounts']],
    verified: V1015,
  },
  {
    id: 'us-ssn', t: 'Social Security numbers for you and your children',
    tags: 'us usa social security number ssn itin children born abroad crba consular report of birth abroad passport number need',
    plain: [
      'Your US tax return needs your US Social Security number (SSN). If you have lost track of it, it is on old US tax or payroll documents, or the Social Security Administration can confirm it.',
      'Children born in the UK to an American parent can usually be registered as US citizens (a "Consular Report of Birth Abroad" through the US Embassy) and then get an SSN. A child\'s number must be issued by the return\'s due date (including any extension) for that year\'s child tax credit — a number obtained later does not count, even on a late return.',
      'Your husband does not need a US number if you file as married filing separately or head of household — you just write "NRA" (non-resident alien) where his number would go.',
    ],
    what: 'A return requires the taxpayer\'s TIN. Qualifying children for s.24 need an SSN valid for employment issued before the return due date (including extensions). A non-resident alien spouse of a separate filer without a TIN is identified as "NRA" per the Form 1040 instructions.',
    cites: [['IRC s.24(h)(7)', 'SSN requirement for a qualifying child'], ['Form 1040 instructions', 'Spouse without an SSN']],
    verified: V1015,
  },
  {
    id: 'us-state-tax', t: 'US state tax when living in the UK',
    tags: 'us usa state tax state return california virginia new york domicile former resident do i file a state return',
    plain: [
      'Most Americans living permanently in the UK do not need to file a US state tax return — only the federal one.',
      'But a few states can keep treating you as a resident if you still have strong ties there — a home, a driving licence, voter registration, or a clear plan to return. California, Virginia, New Mexico and South Carolina are the states most often mentioned for this.',
      'If you left a state some years ago and have no real ties left, you are usually fine. If you still own a home there or plan to go back, check that state\'s rules.',
    ],
    what: 'State income tax depends on state residence or domicile rules, which vary. States such as California, Virginia, New Mexico and South Carolina may continue to treat a former resident who retains domicile as resident. The portal computes federal tax only.',
    cites: [['State law', 'Residence and domicile tests vary by state']],
    verified: V1015,
  },
  {
    id: 'us-catching-up', t: 'Catching up on years you did not file',
    tags: 'us usa missed years behind not filed catch up late past years streamlined foreign offshore procedures penalties amnesty 14653 never filed',
    plain: [
      'Many Americans abroad do not realise they need to file every year. If that is you, there is an official catch-up route with no penalties for people who simply did not know: the "Streamlined Foreign Offshore Procedures".',
      'You file the last 3 years of tax returns and the last 6 years of FBARs, pay any tax and interest due (often none), and sign a statement (Form 14653) certifying that the failure was not deliberate — a genuine mistake or not knowing. That statement is made under penalty of perjury, so it has to be true.',
      'To use it you must have lived outside the US: in at least one of the last three years, spent at least 330 full days outside the US and had no home in the US.',
      'It is closed to you once the IRS has started an examination of your returns, so it is better done sooner than later. A US tax preparer can do the whole package.',
    ],
    what: 'Streamlined Foreign Offshore Procedures: delinquent or amended returns for the most recent 3 years whose due dates have passed and FBARs for the most recent 6 years; payment of tax and interest; Form 14653 certifying non-wilful conduct. Non-residency: no US abode and outside the US at least 330 full days in one or more of the last three years. No failure-to-file, failure-to-pay, accuracy-related, information-return or FBAR penalties apply.',
    cites: [['IRS', 'U.S. taxpayers residing outside the United States — Streamlined Foreign Offshore Procedures'], ['Form 14653', 'Certification by U.S. person residing outside the United States']],
    verified: V1015,
  },
  {
    id: 'us-house-sale', t: 'Selling your house: the US side',
    tags: 'us usa sell selling sold house sale main residence 121 exclusion mortgage currency gain',
    plain: [
      'Selling your home in the UK is usually free of UK tax, but the US looks at it separately.',
      'The US lets you leave out up to $250,000 of profit on your main home, if you have owned it and lived in it as your main home for at least 2 of the last 5 years, and have not used this relief in the last 2 years. If the house is jointly owned with your husband, only your share of the profit goes on your US return. Profit above the limit is taxable in the US — and there may be no UK tax to set against it.',
      'The US measures the profit in dollars, using the exchange rate when you bought and when you sold. So a change in the pound can create a US "profit" even if the house did not go up in pounds — or hide one.',
      'There is also a trap with the mortgage: if the pound fell between taking out the mortgage and paying it off, the US can treat the smaller dollar amount you repaid as a taxable currency gain.',
      'If you are planning to sell a property, work out the US position before you sell. The screen does not calculate it.',
    ],
    what: 'IRC s.121 excludes up to $250,000 of gain on a principal residence ($500,000 for qualifying joint filers), subject to 2-of-5-year ownership and use tests and once in any 2 years (s.121(a), (b)(3)); a jointly owned home is reported in proportion to ownership. Gain is computed in US dollars at historic rates. Repayment of a foreign-currency mortgage at a favourable exchange rate can produce s.988 foreign currency gain, which is taxable; a loss on a personal-use liability is not deductible.',
    judgement: 'Whether and how much s.988 gain arises on a mortgage repayment depends on the principal amounts and rates over the life of the loan; the calculation is fact-specific and should be done before a sale or remortgage.',
    cites: [['IRC s.121', 'Exclusion of gain on sale of principal residence'], ['IRC s.988', 'Foreign currency transactions']],
    verified: V1015,
  },
  {
    id: 'us-forms', t: 'What the US forms are',
    tags: 'us usa forms 1040 schedule 1 2 3 b 8812 2555 1116 8960 8938 4868 which forms what is form list of forms',
    plain: [
      'Form 1040 is the main US tax return — the equivalent of the UK SA100. Everything else attaches to it.',
      'Schedule 1: extra income and adjustments, including the foreign earned income exclusion. Schedule 2: extra taxes, such as the 3.8% investment income tax. Schedule 3: extra credits, including the foreign tax credit. Schedule B: interest and dividends, and the yes/no question about foreign accounts.',
      'Schedule 8812: the child tax credit. Form 2555: the foreign earned income exclusion. Form 1116: the foreign tax credit (one for each type of income). Form 8960: the 3.8% investment income tax. Form 8938: foreign assets, if over the limit.',
      'Form 4868: asks for more time to file. The FBAR (FinCEN Form 114) is not an IRS form at all — it is filed separately online.',
      'The US return screen lists which of these your year needs.',
    ],
    what: 'Form 1040 with Schedules 1 (additional income and adjustments), 2 (additional taxes), 3 (additional credits and payments), B (interest, ordinary dividends, and Part III foreign accounts), 8812 (child tax credit); Forms 2555, 1116, 8960, 8938 as applicable; Form 4868 for extension; FinCEN 114 filed separately.',
    cites: [['IRS', 'Forms and instructions']],
    verified: V1015,
  },
];
