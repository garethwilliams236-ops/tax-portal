import { createClient } from '@/lib/supabase/server';
import {
  accountPosition,
  allocatedTo,
  outstandingOf,
  returnsNotFiled,
  type Liability,
  type Payment,
  type TaxReturn,
} from '@/lib/tax/ledger';
import type { TaxType } from '@/lib/tax/obligations';

/**
 * Every read here runs as the signed-in user, so row-level security is what
 * decides visibility — not a WHERE clause we could forget. The service-role
 * key is never used on a request path.
 */

export interface EntityRow {
  id: string;
  slug: string;
  name: string;
  type: 'company' | 'individual';
  company_number: string | null;
  utr: string | null;
  vrn: string | null;
  year_end_month: number | null;
  year_end_day: number | null;
  vat_registered: boolean;
  vat_stagger: string | null;
  trading_status: 'trading' | 'non_trading' | 'dormant';
  is_close_investment_holding_company: boolean;
  active: boolean;
}

const d = (s: string | null): Date | undefined => (s ? new Date(s + 'T00:00:00.000Z') : undefined);

export async function getEntities(): Promise<EntityRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('entities')
    .select('*')
    .eq('active', true)
    .order('type', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(`entities: ${error.message}`);
  return (data ?? []) as EntityRow[];
}

export async function getEntityBySlug(slug: string): Promise<EntityRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from('entities').select('*').eq('slug', slug).maybeSingle();
  if (error) throw new Error(`entity ${slug}: ${error.message}`);
  return (data as EntityRow) ?? null;
}

export async function getReturns(entityId?: string): Promise<TaxReturn[]> {
  const supabase = await createClient();
  let q = supabase.from('tax_returns').select('*');
  if (entityId) q = q.eq('entity_id', entityId);
  const { data, error } = await q.order('file_by', { ascending: true });
  if (error) throw new Error(`tax_returns: ${error.message}`);
  return (data ?? []).map((r: any): TaxReturn => ({
    id: r.id,
    entityId: r.entity_id,
    taxType: r.tax_type as TaxType,
    periodKey: r.period_key,
    periodStart: d(r.period_start),
    periodEnd: d(r.period_end)!,
    fileBy: d(r.file_by)!,
    payBy: d(r.pay_by)!,
    status: r.status,
    declaredAmount: r.declared_amount === null ? null : Number(r.declared_amount),
    filedOn: d(r.filed_on) ?? null,
    submissionReference: r.submission_reference ?? undefined,
    estimateAmount: r.estimate_amount === null ? null : Number(r.estimate_amount),
  }));
}

export async function getLiabilities(entityId?: string): Promise<Liability[]> {
  const supabase = await createClient();
  let q = supabase.from('liabilities').select('*');
  if (entityId) q = q.eq('entity_id', entityId);
  const { data, error } = await q.order('due_date', { ascending: true });
  if (error) throw new Error(`liabilities: ${error.message}`);
  return (data ?? []).map((l: any): Liability => ({
    id: l.id,
    entityId: l.entity_id,
    taxType: l.tax_type as TaxType,
    periodKey: l.period_key ?? '',
    kind: l.kind,
    label: l.label,
    detail: l.detail ?? undefined,
    amount: Number(l.amount),
    dueDate: d(l.due_date)!,
    returnId: l.return_id ?? undefined,
    isEstimated: l.is_estimated,
  }));
}

export async function getPayments(entityId?: string): Promise<Payment[]> {
  const supabase = await createClient();
  let q = supabase.from('payments').select('*, payment_allocations(liability_id, amount)');
  if (entityId) q = q.eq('entity_id', entityId);
  const { data, error } = await q.order('paid_on', { ascending: false });
  if (error) throw new Error(`payments: ${error.message}`);
  return (data ?? []).map((p: any): Payment => ({
    id: p.id,
    entityId: p.entity_id,
    taxType: p.tax_type as TaxType,
    amount: Number(p.amount),
    paidOn: d(p.paid_on)!,
    direction: p.direction,
    reference: p.reference ?? undefined,
    allocations: (p.payment_allocations ?? []).map((a: any) => ({
      liabilityId: a.liability_id,
      amount: Number(a.amount),
    })),
  }));
}

export interface TaxLine {
  taxType: TaxType;
  charged: number;
  paid: number;
  outstanding: number;
  overdue: number;
  credit: number;
  nextDue: Liability | null;
  lastFiled: TaxReturn | null;
  nextReturn: TaxReturn | null;
  notFiled: number;
}

/** The per-tax position for one entity, computed by the same pure functions the tests cover. */
export function taxLinesFor(
  entity: EntityRow,
  returns: TaxReturn[],
  liabilities: Liability[],
  payments: Payment[],
  asAt: Date,
): TaxLine[] {
  const taxes: TaxType[] =
    entity.type === 'company'
      ? entity.trading_status === 'dormant'
        ? []
        : (['CT', ...(entity.vat_registered ? (['VAT'] as TaxType[]) : []), 'PAYE'] as TaxType[])
      : (['SA'] as TaxType[]);

  return taxes.map((t) => {
    const rs = returns.filter((r) => r.entityId === entity.id && r.taxType === t);
    const ls = liabilities.filter((l) => l.entityId === entity.id && l.taxType === t);
    const ps = payments.filter((p) => p.entityId === entity.id && p.taxType === t);
    const A = accountPosition(ls, ps, asAt);
    const filed = rs.filter((r) => r.status === 'filed');
    const open = rs.filter((r) => r.status !== 'filed');
    return {
      taxType: t,
      charged: A.charged,
      paid: A.paid,
      outstanding: A.outstanding,
      overdue: A.overdue,
      credit: A.credit,
      nextDue: A.nextDue,
      lastFiled: filed[filed.length - 1] ?? null,
      nextReturn: open[0] ?? null,
      notFiled: returnsNotFiled(rs, asAt).length,
    };
  });
}

export { allocatedTo, outstandingOf };
