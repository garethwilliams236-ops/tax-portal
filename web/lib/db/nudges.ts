import { createClient } from '@/lib/supabase/server';
import { getEntities, getReturns } from './queries';
import { getPayroll, payFor } from './payroll';
import { toConfig } from './slots';
import { generateObligations } from '@/lib/tax/obligations';
import { assessEmploymentAllowance } from '@/lib/tax/paye-nic';
import { deadlineNudges, correspondenceNudges, employmentAllowanceNudges, collate, type Nudge } from '@/lib/tax/nudges';
import { taxYearOf, type TaxYear } from '@/lib/tax/rates';

/**
 * What needs doing, worked out from what the portal holds.
 *
 * The rules live in `lib/tax/nudges.ts` and are pure. This file is the part
 * that goes and gets the facts, and it is deliberately thin: every rule is
 * given a signal built here and nothing decides anything on the way.
 *
 * Nothing is stored. A nudge is derived on every render from the obligation
 * calendar, the returns actually filed, the payroll and the correspondence —
 * so a nudge cannot survive the thing that caused it. What IS stored is your
 * disposition towards one: snoozed, dismissed, done. That is a fact about you,
 * not about the tax, and it is the only part the database keeps.
 */

/** How far ahead the deadline rules look. Beyond 30 days they say nothing. */
const HORIZON_DAYS = 45;

export async function buildNudges(asAt: Date): Promise<Nudge[]> {
  const entities = await getEntities();
  if (!entities.length) return [];

  const [returns, correspondence] = await Promise.all([
    getReturns(),
    openCorrespondence(),
  ]);

  const out: Nudge[] = [];

  // --- statutory deadlines -------------------------------------------------
  // A deadline whose return is already FILED is not a deadline any more. This
  // is the whole reason the rules take obligations rather than reading the
  // calendar themselves: filing is what silences them.
  const from = new Date(asAt); from.setUTCDate(from.getUTCDate() - 400);
  const to = new Date(asAt); to.setUTCDate(to.getUTCDate() + HORIZON_DAYS);

  const filed = new Set(
    returns
      .filter((r) => r.status === 'filed')
      .map((r) => `${r.entityId}|${r.taxType}|${r.periodKey}`),
  );

  const obligations = generateObligations(entities.map(toConfig), from, to).filter((o) => {
    if (!o.periodEnd) return true;
    const key = o.taxType === 'SA'
      ? taxYearOf(o.periodEnd)
      : o.periodEnd.toISOString().slice(0, 10);
    return !filed.has(`${o.entityId}|${o.taxType}|${key}`);
  });

  out.push(...deadlineNudges(obligations, asAt));

  // --- correspondence ------------------------------------------------------
  out.push(...correspondenceNudges(correspondence, asAt));

  // --- Employment Allowance ------------------------------------------------
  // Only worth saying for a trading company, and only while the tax year is
  // still running: £10,500 is recoverable by a decision taken in February and
  // gone by a discovery made in June.
  const taxYear = taxYearOf(asAt) as TaxYear;
  const taxYearEnd = new Date(Date.UTC(Number(taxYear.slice(0, 4)) + 1, 3, 5));

  for (const e of entities) {
    if (e.type !== 'company' || e.trading_status === 'dormant') continue;
    const people = await getPayroll(e.id);
    if (!people.length) continue;

    const assessment = assessEmploymentAllowance(
      people.map((p) => {
        const pay = payFor(p, taxYear);
        return {
          personId: p.id,
          name: p.name,
          isDirector: p.isDirector,
          annualEarnings: pay.annualPay,
          directorshipStartedOn: p.directorshipStartedOn ?? undefined,
        };
      }),
      taxYear,
    );

    out.push(...employmentAllowanceNudges([{
      entityId: e.id,
      entityName: e.name,
      taxYear,
      taxYearEnd,
      eligible: assessment.eligible,
      headsAboveSecondaryThreshold: assessment.headsAboveSecondaryThreshold,
      allowance: assessment.allowance,
      secondaryThreshold: assessment.secondaryThreshold,
    }], asAt));
  }

  return collate(out);
}

/**
 * Correspondence still wanting a reply.
 *
 * Read here rather than through `getCorrespondence` for every entity, because
 * this is one query across all of them and the attachments are not wanted.
 */
async function openCorrespondence() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('correspondence')
    .select('id, entity_id, subject, response_due, entities(name)')
    .not('response_due', 'is', null)
    .neq('response_status', 'closed');
  if (error) throw new Error(`correspondence: ${error.message}`);

  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data ?? []).map((r: any) => ({
    id: r.id as string,
    entityId: r.entity_id as string,
    entityName: (r.entities?.name ?? '') as string,
    subject: r.subject as string,
    responseDue: new Date(r.response_due + 'T00:00:00.000Z'),
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
