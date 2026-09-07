'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { chargeFromReturn, paymentsOnAccount, allocateOldestFirst, type Liability, type TaxReturn } from '@/lib/tax/ledger';
import type { TaxType } from '@/lib/tax/obligations';
import { getLiabilities, getPayments, getReturns } from '@/lib/db/queries';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const TY = (n: number) => `${n}-${String((n + 1) % 100).padStart(2, '0')}`;

/**
 * File a return.
 *
 * This is the only way a liability comes into existence for a declared tax, and
 * the database enforces that: `liabilities_require_a_filed_return` refuses a
 * return_charge whose return is not filed with an amount. Filing therefore does
 * two things in order — record what the return said, then charge what it
 * declared, less whatever statute already charged in advance.
 */
export async function fileReturn(formData: FormData) {
  const supabase = await createClient();

  const entityId = String(formData.get('entity_id'));
  const taxType = String(formData.get('tax_type')) as TaxType;
  const periodKey = String(formData.get('period_key'));
  const status = String(formData.get('status')) as TaxReturn['status'];
  const declaredRaw = String(formData.get('declared_amount') ?? '');
  const declared = declaredRaw === '' ? null : Number(declaredRaw);
  const filedOn = String(formData.get('filed_on') ?? '') || null;

  if (status === 'filed' && declared === null) {
    throw new Error('A filed return has to declare an amount. Enter 0 if it declared nil.');
  }

  const payload = {
    entity_id: entityId,
    tax_type: taxType,
    period_key: periodKey,
    period_start: String(formData.get('period_start') ?? '') || null,
    period_end: String(formData.get('period_end')),
    file_by: String(formData.get('file_by')),
    pay_by: String(formData.get('pay_by')),
    status,
    declared_amount: declared,
    filed_on: status === 'filed' ? filedOn : null,
    submission_reference: String(formData.get('submission_reference') ?? '') || null,
    estimate_amount: String(formData.get('estimate_amount') ?? '') === '' ? null : Number(formData.get('estimate_amount')),
    estimate_source: 'engine',
    updated_at: new Date().toISOString(),
  };

  const { data: ret, error } = await supabase
    .from('tax_returns')
    .upsert(payload, { onConflict: 'entity_id,tax_type,period_key' })
    .select('*')
    .single();
  if (error) throw new Error(`filing: ${error.message}`);

  if (status === 'filed' && declared !== null) {
    await chargeFor(entityId, taxType, periodKey, ret.id, declared, String(payload.pay_by));
  }

  revalidatePath('/', 'layout');
}

/** Charges arising once a return is filed, including the SA balancing payment. */
async function chargeFor(
  entityId: string, taxType: TaxType, periodKey: string,
  returnId: string, declared: number, payBy: string,
) {
  const supabase = await createClient();

  // Payments on account are charged BY STATUTE from the preceding year's
  // declared figure, before this year's return exists. They must be in place
  // before the balancing payment can be computed.
  let advance: Liability[] = [];
  if (taxType === 'SA') {
    advance = await ensurePaymentsOnAccount(entityId, periodKey);
  }

  const charge = chargeFromReturn(
    {
      id: returnId, entityId, taxType, periodKey,
      periodEnd: new Date(payBy), fileBy: new Date(payBy), payBy: new Date(payBy),
      status: 'filed', declaredAmount: declared,
    },
    advance,
  );
  if (!charge) return;

  const { error } = await supabase.from('liabilities').upsert(
    {
      entity_id: entityId, tax_type: taxType, period_key: periodKey,
      kind: charge.kind, label: charge.label, detail: charge.detail ?? null,
      amount: charge.amount, due_date: payBy, return_id: returnId, is_estimated: false,
    },
    { onConflict: 'entity_id,tax_type,period_key,kind,due_date' },
  );
  if (error) throw new Error(`charge: ${error.message}`);
}

/** TMA 1970 s.59A — half the preceding year's declared liability, twice. */
async function ensurePaymentsOnAccount(entityId: string, taxYear: string): Promise<Liability[]> {
  const supabase = await createClient();
  const startYear = Number(taxYear.slice(0, 4));
  const prior = TY(startYear - 1);

  const { data: priorReturn } = await supabase
    .from('tax_returns')
    .select('declared_amount, status')
    .eq('entity_id', entityId).eq('tax_type', 'SA').eq('period_key', prior)
    .maybeSingle();

  if (!priorReturn || priorReturn.status !== 'filed' || priorReturn.declared_amount === null) return [];

  const poas = paymentsOnAccount({
    entityId, taxYear, priorTaxYear: prior,
    priorYearLiability: Number(priorReturn.declared_amount),
    firstDue: new Date(Date.UTC(startYear + 1, 0, 31)),
    secondDue: new Date(Date.UTC(startYear + 1, 6, 31)),
  });

  for (const p of poas) {
    const { error } = await supabase.from('liabilities').upsert(
      {
        entity_id: entityId, tax_type: 'SA', period_key: taxYear,
        kind: p.kind, label: p.label, detail: p.detail ?? null,
        amount: p.amount, due_date: iso(p.dueDate), return_id: null, is_estimated: false,
      },
      { onConflict: 'entity_id,tax_type,period_key,kind,due_date' },
    );
    if (error) throw new Error(`payments on account: ${error.message}`);
  }
  return poas;
}

/** Record a payment and allocate it, oldest debt first unless told otherwise. */
export async function recordPayment(formData: FormData) {
  const supabase = await createClient();

  const entityId = String(formData.get('entity_id'));
  const taxType = String(formData.get('tax_type')) as TaxType;
  const amount = Number(formData.get('amount'));
  const paidOn = String(formData.get('paid_on'));
  const direction = String(formData.get('direction') ?? 'to_hmrc');
  const autoAllocate = formData.get('auto_allocate') === 'on';

  if (!amount) throw new Error('Enter an amount.');

  const { data: payment, error } = await supabase
    .from('payments')
    .insert({
      entity_id: entityId, tax_type: taxType, amount, paid_on: paidOn,
      direction, reference: String(formData.get('reference') ?? '') || null, source: 'manual',
    })
    .select('id')
    .single();
  if (error) throw new Error(`payment: ${error.message}`);

  if (autoAllocate && direction === 'to_hmrc') {
    const [liabilities, payments] = await Promise.all([
      getLiabilities(entityId), getPayments(entityId),
    ]);
    const scoped = liabilities.filter((l) => l.taxType === taxType);
    const allocs = allocateOldestFirst(amount, scoped, payments.filter((p) => p.taxType === taxType));
    for (const a of allocs) {
      const { error: aerr } = await supabase.from('payment_allocations').insert({
        payment_id: payment.id, liability_id: a.liabilityId, amount: a.amount,
      });
      if (aerr) throw new Error(`allocation: ${aerr.message}`);
    }
  }

  revalidatePath('/', 'layout');
}

/** Interest, penalties and HMRC amendments — charged outside the return cycle. */
export async function addCharge(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from('liabilities').insert({
    entity_id: String(formData.get('entity_id')),
    tax_type: String(formData.get('tax_type')),
    period_key: String(formData.get('period_key') ?? '') || null,
    kind: String(formData.get('kind')),
    label: String(formData.get('label') ?? 'Charge'),
    amount: Number(formData.get('amount')),
    due_date: String(formData.get('due_date')),
    return_id: null,
  });
  if (error) throw new Error(`charge: ${error.message}`);
  revalidatePath('/', 'layout');
}

export { getReturns };
