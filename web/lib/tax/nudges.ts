/**
 * Nudge rules engine.
 *
 * Each rule emits candidate tasks with a `ruleKey` and `periodKey`. The unique
 * constraint on (entityId, ruleKey, periodKey) means re-evaluation UPDATES
 * rather than duplicates — the single most important detail here, because a
 * nudge engine that spams is one you turn off within a fortnight.
 *
 * Priority is 1 (highest) to 5. Escalation is automatic as a due date nears, so
 * ordering the dashboard is just an ORDER BY.
 */

import type { Obligation } from './obligations.js';

export type NudgeCategory =
  | 'filing'
  | 'payment'
  | 'planning'
  | 'data'
  | 'correspondence'
  | 'structural';

export interface Nudge {
  entityId: string | null;
  entityName: string | null;
  ruleKey: string;
  periodKey: string;
  title: string;
  detail: string;
  category: NudgeCategory;
  priority: number;
  dueDate?: Date;
}

const DAY = 86_400_000;

function daysUntil(date: Date, asAt: Date): number {
  return Math.ceil((date.getTime() - asAt.getTime()) / DAY);
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Statutory deadlines — escalating
// ---------------------------------------------------------------------------

const ESCALATION = [
  { within: 0, priority: 1, label: 'OVERDUE' },
  { within: 1, priority: 1, label: 'due tomorrow' },
  { within: 7, priority: 2, label: 'due within 7 days' },
  { within: 14, priority: 3, label: 'due within 14 days' },
  { within: 30, priority: 4, label: 'due within 30 days' },
];

export function deadlineNudges(obligations: Obligation[], asAt: Date): Nudge[] {
  const out: Nudge[] = [];

  for (const o of obligations) {
    const days = daysUntil(o.dueDate, asAt);
    if (days > 30) continue;

    const step = ESCALATION.find((e) => days <= e.within);
    if (!step) continue;

    // An unextendable deadline is escalated a full level harder, and never
    // sits below priority 2 even at 30 days out.
    const priority = o.isUnextendable ? Math.max(1, step.priority - 1) : step.priority;

    out.push({
      entityId: o.entityId,
      entityName: o.entityName,
      ruleKey: `deadline:${o.taxType}:${o.kind}`,
      periodKey: isoDay(o.dueDate),
      title: `${o.description} — ${days < 0 ? `${Math.abs(days)} days OVERDUE` : step.label}`,
      detail:
        `${o.entityName}: ${o.description}, due ${isoDay(o.dueDate)}.` +
        (o.citation ? ` ${o.citation}` : '') +
        (o.isUnextendable ? ' THIS DEADLINE CANNOT BE EXTENDED OR RECOVERED.' : ''),
      category: o.kind === 'payment' ? 'payment' : 'filing',
      priority: o.isUnextendable ? Math.min(priority, 2) : priority,
      dueDate: o.dueDate,
    });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Structural events — the class specific to a two-company owner
// ---------------------------------------------------------------------------

export interface DormantActivitySignal {
  entityId: string;
  entityName: string;
  /** Any transaction seen in the period — bank charge, fee, anything. */
  transactionSeenOn: Date;
  description: string;
  subjectCompanyName: string;
  subjectPeriodEnd: Date;
}

/**
 * A transaction in the supposedly-inactive company. It may be harmless — a bank
 * charge is not a trade or business — but it may have broken the s.18E(3)
 * disregard and halved the trading company's limits for the WHOLE period.
 *
 * Better to investigate a bank charge that turns out to be nothing than to
 * discover a trade at the year end, when nothing can be done about it.
 */
export function dormantActivityNudges(signals: DormantActivitySignal[]): Nudge[] {
  return signals.map((s) => ({
    entityId: s.entityId,
    entityName: s.entityName,
    ruleKey: 'structural:dormant_activity',
    periodKey: isoDay(s.transactionSeenOn),
    title: `Activity in ${s.entityName} — check the s.18E position`,
    detail:
      `A transaction was recorded in ${s.entityName} on ${isoDay(s.transactionSeenOn)}: ${s.description}. ` +
      `If this amounts to carrying on a trade or business, the CTA 2010 s.18E(3) disregard is lost and ` +
      `${s.subjectCompanyName}'s limits are halved for the WHOLE accounting period ending ` +
      `${isoDay(s.subjectPeriodEnd)} — there is no apportionment (CTM03956). Bank interest alone is not a ` +
      `business (Jowett), and a bank charge is not either, but confirm and record the reasoning against the period.`,
    category: 'structural',
    priority: 2,
  }));
}

export interface TradeStartPlan {
  entityId: string;
  entityName: string;
  subjectCompanyName: string;
  subjectPeriodEnd: Date;
  intendedStartDate: Date;
  additionalTaxIfStartedInPeriod: number;
}

export function tradeStartNudges(plans: TradeStartPlan[], asAt: Date): Nudge[] {
  return plans
    .filter((p) => p.intendedStartDate <= p.subjectPeriodEnd)
    .map((p) => ({
      entityId: p.entityId,
      entityName: p.entityName,
      ruleKey: 'planning:trade_start_date',
      periodKey: isoDay(p.subjectPeriodEnd),
      title: `Starting ${p.entityName} before ${isoDay(p.subjectPeriodEnd)} costs about £${Math.round(p.additionalTaxIfStartedInPeriod).toLocaleString()}`,
      detail:
        `Starting to trade on ${isoDay(p.intendedStartDate)} falls inside ${p.subjectCompanyName}'s accounting ` +
        `period ending ${isoDay(p.subjectPeriodEnd)}. Under s.18E(1) the company is then associated for the ` +
        `WHOLE period, so the limits halve retrospectively — roughly £${Math.round(p.additionalTaxIfStartedInPeriod).toLocaleString()} ` +
        `of additional Corporation Tax on the same profit. Starting on or after ` +
        `${isoDay(new Date(p.subjectPeriodEnd.getTime() + DAY))} confines the effect to a period you have planned for.`,
      category: 'planning',
      priority: 2,
      dueDate: p.subjectPeriodEnd,
    }));
}

// ---------------------------------------------------------------------------
// Employment Allowance — while the year is still open
// ---------------------------------------------------------------------------

export interface EaSignal {
  entityId: string;
  entityName: string;
  taxYear: string;
  taxYearEnd: Date;
  eligible: boolean;
  headsAboveSecondaryThreshold: number;
  allowance: number;
  secondaryThreshold: number;
}

/**
 * £10,500 is recoverable by a decision taken in February and unrecoverable by a
 * discovery made in June. That asymmetry is the whole reason this rule exists.
 */
export function employmentAllowanceNudges(signals: EaSignal[], asAt: Date): Nudge[] {
  const out: Nudge[] = [];
  for (const s of signals) {
    if (s.eligible) continue;
    const daysLeft = daysUntil(s.taxYearEnd, asAt);
    if (daysLeft < 0) continue;

    out.push({
      entityId: s.entityId,
      entityName: s.entityName,
      ruleKey: 'planning:employment_allowance',
      periodKey: s.taxYear,
      title: `${s.entityName} is not on track to claim the £${s.allowance.toLocaleString()} Employment Allowance`,
      detail:
        `Only ${s.headsAboveSecondaryThreshold} person is paid above the annual secondary threshold of ` +
        `£${s.secondaryThreshold.toLocaleString()} in ${s.taxYear}. HMRC's test counts heads paid above that ` +
        `threshold, not directorships (NIM06545), so a second director paid nothing or a token amount does not ` +
        `help. Paying a second person above £${s.secondaryThreshold.toLocaleString()} before ` +
        `${isoDay(s.taxYearEnd)} secures the allowance for the whole tax year — ${daysLeft} days remain. ` +
        `Note that connected companies share ONE allowance (NICA 2014 s.3).`,
      category: 'planning',
      // Escalates as the year end approaches: this is a use-it-or-lose-it window.
      priority: daysLeft <= 60 ? 1 : daysLeft <= 120 ? 2 : 3,
      dueDate: s.taxYearEnd,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Planning windows — allowances that expire
// ---------------------------------------------------------------------------

export interface AllowanceSignal {
  entityId: string;
  entityName: string;
  allowance: 'pension_aa' | 'isa' | 'cgt_aea' | 'iht_annual' | 'dividend';
  taxYear: string;
  limitAmount: number;
  usedAmount: number;
  expiresOn: Date;
  /** For carry-forward allowances, the year the unused amount originated. */
  originYear?: string;
}

const ALLOWANCE_LABELS: Record<AllowanceSignal['allowance'], string> = {
  pension_aa: 'pension annual allowance',
  isa: 'ISA allowance',
  cgt_aea: 'CGT annual exempt amount',
  iht_annual: 'IHT annual exemption',
  dividend: 'dividend allowance',
};

export function allowanceExpiryNudges(signals: AllowanceSignal[], asAt: Date): Nudge[] {
  const out: Nudge[] = [];
  for (const s of signals) {
    const unused = s.limitAmount - s.usedAmount;
    if (unused <= 0) continue;
    const daysLeft = daysUntil(s.expiresOn, asAt);
    if (daysLeft < 0 || daysLeft > 120) continue;

    const label = ALLOWANCE_LABELS[s.allowance];
    const carryNote =
      s.allowance === 'pension_aa' && s.originYear
        ? ` Unused allowance from ${s.originYear} is the oldest available and is used first, so it is the ` +
          `first to be lost.`
        : s.allowance === 'iht_annual'
          ? ` The IHT annual exemption carries forward one year only — use it or lose it.`
          : '';

    out.push({
      entityId: s.entityId,
      entityName: s.entityName,
      ruleKey: `planning:allowance_expiry:${s.allowance}`,
      periodKey: s.originYear ?? s.taxYear,
      title: `£${Math.round(unused).toLocaleString()} of ${label} expires ${isoDay(s.expiresOn)}`,
      detail:
        `${s.entityName} has used £${Math.round(s.usedAmount).toLocaleString()} of a ` +
        `£${Math.round(s.limitAmount).toLocaleString()} ${label} for ${s.taxYear}, leaving ` +
        `£${Math.round(unused).toLocaleString()} unused with ${daysLeft} days to run.${carryNote}`,
      category: 'planning',
      priority: daysLeft <= 30 ? 1 : daysLeft <= 60 ? 2 : 3,
      dueDate: s.expiresOn,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// PET anniversaries and the gift ledger
// ---------------------------------------------------------------------------

export interface PetSignal {
  entityId: string;
  entityName: string;
  giftId: string;
  giftDate: Date;
  value: number;
  beneficiary?: string;
}

const PET_MILESTONES = [3, 5, 7];

export function petAnniversaryNudges(signals: PetSignal[], asAt: Date): Nudge[] {
  const out: Nudge[] = [];
  const YEAR = 365.25 * DAY;

  for (const g of signals) {
    for (const years of PET_MILESTONES) {
      const milestone = new Date(g.giftDate.getTime() + years * YEAR);
      const daysLeft = daysUntil(milestone, asAt);
      if (daysLeft < 0 || daysLeft > 60) continue;

      const meaning =
        years === 7
          ? 'the gift falls out of the seven-year cumulation entirely and the nil-rate band it absorbed is restored'
          : `taper relief on any tax borne by the gift steps up to ${years === 3 ? '20%' : '60%'}`;

      out.push({
        entityId: g.entityId,
        entityName: g.entityName,
        ruleKey: `planning:pet_anniversary:${g.giftId}`,
        periodKey: String(years),
        title: `${years}-year point on a £${g.value.toLocaleString()} gift falls ${isoDay(milestone)}`,
        detail:
          `The gift of £${g.value.toLocaleString()} made on ${isoDay(g.giftDate)}` +
          (g.beneficiary ? ` to ${g.beneficiary}` : '') +
          ` reaches its ${years}-year point on ${isoDay(milestone)}, at which ${meaning}. ` +
          (years < 7
            ? 'Remember taper reduces the tax on the gift, not its value — and only where the gift bears tax ' +
              'in its own right after cumulation.'
            : ''),
        category: 'planning',
        priority: 4,
        dueDate: milestone,
      });
    }
  }
  return out;
}

/**
 * Normal expenditure out of income is claimed on IHT403 AFTER death, by
 * executors, from records kept contemporaneously. Prompting for the schedule
 * while the figures are to hand is arguably the most valuable thing the estate
 * module does.
 */
export function normalExpenditureEvidenceNudge(args: {
  entityId: string;
  entityName: string;
  taxYear: string;
  taxYearEnd: Date;
  scheduleRecorded: boolean;
  asAt: Date;
}): Nudge[] {
  if (args.scheduleRecorded) return [];
  const daysLeft = daysUntil(args.taxYearEnd, args.asAt);
  if (daysLeft < -180 || daysLeft > 90) return [];

  return [
    {
      entityId: args.entityId,
      entityName: args.entityName,
      ruleKey: 'planning:normal_expenditure_evidence',
      periodKey: args.taxYear,
      title: `Record the ${args.taxYear} income and expenditure schedule`,
      detail:
        `No normal-expenditure-out-of-income schedule has been recorded for ${args.taxYear}. The exemption is ` +
        `unlimited but needs all three limbs — habitual, out of income not capital, and leaving sufficient income ` +
        `to maintain the usual standard of living. The claim is made on IHT403 after death, by your executors, ` +
        `from records you kept. Record it now while the figures are to hand.`,
      category: 'planning',
      priority: 3,
      dueDate: args.taxYearEnd,
    },
  ];
}

// ---------------------------------------------------------------------------
// Thresholds and data health
// ---------------------------------------------------------------------------

export function vatThresholdNudges(
  signals: { entityId: string; entityName: string; rolling12MonthTurnover: number; threshold: number }[],
): Nudge[] {
  return signals
    .filter((s) => s.rolling12MonthTurnover >= s.threshold * 0.8)
    .map((s) => ({
      entityId: s.entityId,
      entityName: s.entityName,
      ruleKey: 'threshold:vat_registration',
      periodKey: 'rolling',
      title: `${s.entityName} is at ${Math.round((s.rolling12MonthTurnover / s.threshold) * 100)}% of the VAT threshold`,
      detail:
        `Rolling 12-month taxable turnover is £${Math.round(s.rolling12MonthTurnover).toLocaleString()} against a ` +
        `£${s.threshold.toLocaleString()} registration threshold. Registration is also triggered if turnover is ` +
        `expected to exceed the threshold in the next 30 days alone, so watch forward orders as well as history.`,
      category: 'planning',
      priority: s.rolling12MonthTurnover >= s.threshold ? 1 : 3,
    }));
}

export function staleSyncNudges(
  signals: { entityId: string; entityName: string; lastSyncAt: Date | null }[],
  asAt: Date,
): Nudge[] {
  return signals
    .filter((s) => !s.lastSyncAt || asAt.getTime() - s.lastSyncAt.getTime() > 2 * DAY)
    .map((s) => ({
      entityId: s.entityId,
      entityName: s.entityName,
      ruleKey: 'data:stale_sync',
      periodKey: isoDay(asAt),
      title: `${s.entityName}: Xero has not synced${s.lastSyncAt ? ` since ${isoDay(s.lastSyncAt)}` : ''}`,
      detail:
        `Figures on the dashboard for ${s.entityName} may be stale. ` +
        (s.lastSyncAt
          ? `Last successful sync was ${isoDay(s.lastSyncAt)}.`
          : 'No successful sync has been recorded.'),
      category: 'data',
      priority: 3,
    }));
}

export function correspondenceNudges(
  items: { entityId: string; entityName: string; id: string; subject: string; responseDue: Date }[],
  asAt: Date,
): Nudge[] {
  const out: Nudge[] = [];
  for (const c of items) {
    const days = daysUntil(c.responseDue, asAt);
    if (days > 21) continue;
    out.push({
      entityId: c.entityId,
      entityName: c.entityName,
      ruleKey: `correspondence:response_due:${c.id}`,
      periodKey: isoDay(c.responseDue),
      title:
        days < 0
          ? `Response to HMRC OVERDUE by ${Math.abs(days)} days: ${c.subject}`
          : `Response to HMRC due in ${days} days: ${c.subject}`,
      detail: `${c.entityName}: "${c.subject}" requires a response by ${isoDay(c.responseDue)}.`,
      category: 'correspondence',
      priority: days < 0 ? 1 : days <= 7 ? 2 : 3,
      dueDate: c.responseDue,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Deduplicate by (entityId, ruleKey, periodKey) keeping the highest priority,
 * then sort. This mirrors the database unique constraint: re-evaluation updates
 * rather than duplicates.
 */
export function collate(nudges: Nudge[]): Nudge[] {
  const seen = new Map<string, Nudge>();
  for (const n of nudges) {
    const key = `${n.entityId ?? 'all'}|${n.ruleKey}|${n.periodKey}`;
    const existing = seen.get(key);
    if (!existing || n.priority < existing.priority) seen.set(key, n);
  }
  return [...seen.values()].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const at = a.dueDate?.getTime() ?? Infinity;
    const bt = b.dueDate?.getTime() ?? Infinity;
    return at - bt;
  });
}
