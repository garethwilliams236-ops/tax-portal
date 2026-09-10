import { createClient } from '@/lib/supabase/server';
import { getEntities, getReturns, getLiabilities, getPayments } from './queries';
import { getPayroll, payFor } from './payroll';
import { toConfig } from './slots';
import { generateObligations, type Obligation } from '@/lib/tax/obligations';
import { assessEmploymentAllowance } from '@/lib/tax/paye-nic';
import { deadlineNudges, correspondenceNudges, employmentAllowanceNudges, collate, type Nudge } from '@/lib/tax/nudges';
import { outstandingOf } from '@/lib/tax/ledger';
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

/**
 * How far back an overdue deadline is still a NUDGE.
 *
 * Beyond this it is not something to do today, it is a backlog, and a backlog
 * belongs on the entity screen — which already colours every unfiled period
 * red — rather than at the top of the list every morning. The first build of
 * this looked back 400 days and produced twenty-six red PAYE lines going back
 * to August 2025, which is precisely the spam the rules engine's own comments
 * warn is what makes people turn a nudge engine off.
 */
const LOOKBACK_DAYS = 90;

/** How far back the ledger is still read, to decide what is genuinely undone. */
const LEDGER_LOOKBACK_DAYS = 800;

export interface Backlog {
  entityId: string;
  entityName: string;
  /** Obligations older than the nudge window with nothing recorded against them. */
  count: number;
  oldest: Date;
}

export interface NudgeResult {
  nudges: Nudge[];
  /** Said once, quietly, instead of shouted once per period. */
  backlog: Backlog[];
}

export async function buildNudges(asAt: Date): Promise<NudgeResult> {
  const entities = await getEntities();
  if (!entities.length) return { nudges: [], backlog: [] };

  const [returns, liabilities, payments, correspondence] = await Promise.all([
    getReturns(), getLiabilities(), getPayments(),
    openCorrespondence(),
  ]);

  const out: Nudge[] = [];

  // --- statutory deadlines -------------------------------------------------
  const from = new Date(asAt); from.setUTCDate(from.getUTCDate() - LEDGER_LOOKBACK_DAYS);
  const to = new Date(asAt); to.setUTCDate(to.getUTCDate() + HORIZON_DAYS);
  const lookbackFrom = new Date(asAt); lookbackFrom.setUTCDate(lookbackFrom.getUTCDate() - LOOKBACK_DAYS);

  const filed = new Set(
    returns
      .filter((r) => r.status === 'filed')
      .map((r) => `${r.entityId}|${r.taxType}|${r.periodKey}`),
  );

  // What the ledger says is genuinely still owed, by period.
  const owed = new Set(
    liabilities
      .filter((l) => outstandingOf(l, payments) > 0.005)
      .map((l) => `${l.entityId}|${l.taxType}|${l.periodKey}`),
  );

  const { obligations, backlog } = selectObligations(
    generateObligations(entities.map(toConfig), from, to),
    { filed, owed, asAt, lookbackFrom },
  );

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

  return { nudges: collate(out), backlog };
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

/**
 * Which obligations are worth raising today.
 *
 * Pure, and separate from the reads above, because this is the part with the
 * judgement in it — and the judgement is what got the first version wrong.
 *
 *   FUTURE      always raised. That is what a reminder is for, and the portal
 *               needs no evidence to remind you of a statutory date.
 *   OVERDUE     raised only where the portal KNOWS something is undone, and
 *               only within the lookback window. For a filing it knows: there
 *               is no filed return. For a payment it does not, unless the
 *               ledger shows an outstanding balance — and absence of a
 *               liability means it was never told, not that money is owed.
 *   OLDER       counted per entity as backlog, and said once.
 *
 * The PAYE monthly payment is what this exists for. Twelve a year per company,
 * none of which the portal is told about, every one of which the first version
 * raised in red going back a year.
 */
export function selectObligations(
  all: Obligation[],
  opts: { filed: Set<string>; owed: Set<string>; asAt: Date; lookbackFrom: Date },
): { obligations: Obligation[]; backlog: Backlog[] } {
  const obligations: Obligation[] = [];
  const backlogBy = new Map<string, Backlog>();

  for (const o of all) {
    const key = o.periodEnd
      ? `${o.entityId}|${o.taxType}|${o.taxType === 'SA' ? taxYearOf(o.periodEnd) : o.periodEnd.toISOString().slice(0, 10)}`
      : null;

    // Filing silences a filing deadline. This is why the rules take
    // obligations rather than reading the calendar themselves.
    if (key && opts.filed.has(key)) continue;

    if (o.dueDate >= opts.asAt) { obligations.push(o); continue; }

    const knowsItIsUndone = o.kind === 'payment' ? (key !== null && opts.owed.has(key)) : true;

    if (o.dueDate >= opts.lookbackFrom && knowsItIsUndone) { obligations.push(o); continue; }

    // A payment the portal was never told about is not a backlog item either —
    // there is nothing to catch up on, only nothing recorded.
    if (o.kind === 'payment' && !knowsItIsUndone) continue;

    const b = backlogBy.get(o.entityId);
    if (!b) {
      backlogBy.set(o.entityId, {
        entityId: o.entityId, entityName: o.entityName, count: 1, oldest: o.dueDate,
      });
    } else {
      b.count += 1;
      if (o.dueDate < b.oldest) b.oldest = o.dueDate;
    }
  }

  return { obligations, backlog: [...backlogBy.values()] };
}
