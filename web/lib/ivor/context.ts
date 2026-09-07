import { getEntities, getLiabilities, getPayments, getReturns, taxLinesFor, outstandingOf } from '@/lib/db/queries';
import { getPayroll, payFor } from '@/lib/db/payroll';
import { assessEmploymentAllowance, type PayrollPerson } from '@/lib/tax/paye-nic';
import { taxYearOf } from '@/lib/tax/rates';
import { money2, fmtD, TAX_LABEL } from '@/lib/format';
import type { Liability } from '@/lib/tax/ledger';

/**
 * The live position, compactly.
 *
 * This is the ONLY source for any figure about this user that reaches an
 * answer. It is read under row-level security as the signed-in user, so Ivor
 * cannot see anything the portal itself would not show.
 */

export interface OpenCharge {
  entity: string;
  taxType: string;
  label: string;
  dueDate: Date;
  outstanding: number;
  overdue: boolean;
}

export interface LiveContext {
  asAt: Date;
  taxYear: string;
  text: string;
  charges: OpenCharge[];
  returnsNotFiled: number;
  entityNames: string[];
}

export async function liveContext(): Promise<LiveContext> {
  const asAt = new Date();
  const taxYear = taxYearOf(asAt);

  const entities = await getEntities();
  const [returns, liabilities, payments] = await Promise.all([
    getReturns(), getLiabilities(), getPayments(),
  ]);

  const lines: string[] = [`As at ${fmtD(asAt)}. Current tax year ${taxYear}.`];
  const charges: OpenCharge[] = [];
  let returnsNotFiled = 0;

  for (const e of entities) {
    const taxes = taxLinesFor(e, returns, liabilities, payments, asAt);

    lines.push(`\nENTITY: ${e.name} (${e.type}${e.type === 'company' ? ', ' + e.trading_status : ''}${
      e.type === 'company' && e.year_end_month
        ? `, year end ${e.year_end_day} ${new Date(Date.UTC(2000, e.year_end_month - 1, 1)).toLocaleString('en-GB', { month: 'long' })}`
        : ''})`);

    if (!taxes.length) {
      lines.push('  No taxes generating obligations (dormant). Companies House filings still apply.');
    }

    for (const t of taxes) {
      returnsNotFiled += t.notFiled;
      const last = t.lastFiled
        ? `${t.lastFiled.periodKey}, declared ${t.lastFiled.declaredAmount === null ? 'NOT recorded' : money2(t.lastFiled.declaredAmount)}`
        : 'none filed';
      lines.push(`  ${TAX_LABEL[t.taxType] ?? t.taxType}: last return ${last}.${
        t.nextReturn ? ` Next return ${t.nextReturn.periodKey}, file by ${fmtD(t.nextReturn.fileBy)}.` : ''
      }${t.notFiled ? ` ${t.notFiled} return(s) past the filing date and not filed.` : ''}`);
      lines.push(`    charged ${money2(t.charged)}, paid ${money2(t.paid)}, outstanding ${money2(t.outstanding)}${
        t.overdue > 0.005 ? `, of which ${money2(t.overdue)} overdue` : ''
      }${t.credit > 0.005 ? `, plus ${money2(t.credit)} unallocated on account` : ''}.`);

      const ps = payments.filter((p) => p.entityId === e.id && p.taxType === t.taxType);
      const open = liabilities
        .filter((l: Liability) => l.entityId === e.id && l.taxType === t.taxType && outstandingOf(l, ps) > 0.005)
        .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

      for (const l of open) {
        const out = outstandingOf(l, ps);
        const overdue = l.dueDate < asAt;
        charges.push({ entity: e.name, taxType: t.taxType, label: l.label, dueDate: l.dueDate, outstanding: out, overdue });
        if (charges.length <= 40) {
          lines.push(`    open: ${money2(out)} ${l.label} due ${fmtD(l.dueDate)}${overdue ? ' (OVERDUE)' : ''}`);
        }
      }
    }

    // Payroll matters to the Employment Allowance question, which is the one
    // most often asked and most often answered wrongly.
    if (e.type === 'company' && e.trading_status !== 'dormant') {
      try {
        const people = await getPayroll(e.id);
        if (people.length) {
          const forEngine: PayrollPerson[] = people.map((p) => ({
            personId: p.id, name: p.name, isDirector: p.isDirector,
            annualEarnings: payFor(p, taxYear).annualPay,
            directorshipStartedOn: p.directorshipStartedOn ?? undefined,
          }));
          const ea = assessEmploymentAllowance(forEngine, taxYear);
          lines.push(`  Payroll ${taxYear}: ${people.length} on the payroll, ${ea.headsAboveSecondaryThreshold} paid above the secondary threshold.`);
          lines.push(`  Employment Allowance: ${ea.eligible ? 'available' : 'NOT available'} — ${ea.reason}`);
        }
      } catch {
        // A missing rate table for the year is not a reason to fail the answer.
      }
    }
  }

  charges.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());

  return {
    asAt, taxYear,
    text: lines.join('\n'),
    charges,
    returnsNotFiled,
    entityNames: entities.map((e) => e.name),
  };
}
