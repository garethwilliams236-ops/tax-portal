'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'entity';

export async function createEntity(formData: FormData) {
  const supabase = await createClient();
  const type = String(formData.get('type')) as 'company' | 'individual';
  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Name is required');

  const row: Record<string, unknown> = {
    slug: slugify(name),
    name,
    type,
    active: true,
  };

  if (type === 'company') {
    row.company_number = String(formData.get('company_number') ?? '') || null;
    row.utr = String(formData.get('utr') ?? '') || null;
    row.year_end_month = Number(formData.get('year_end_month')) || 3;
    row.year_end_day = Number(formData.get('year_end_day')) || 31;
    row.trading_status = String(formData.get('trading_status') ?? 'trading');
    row.vat_registered = formData.get('vat_registered') === 'on';
    row.vrn = String(formData.get('vrn') ?? '') || null;
    row.vat_stagger = String(formData.get('vat_stagger') ?? '3');
    row.is_close_investment_holding_company = formData.get('cihc') === 'on';
  } else {
    row.utr = String(formData.get('utr') ?? '') || null;
    row.ni_number = String(formData.get('ni_number') ?? '') || null;
  }

  // No RETURNING clause, deliberately.
  //
  // `.select()` makes Postgres apply the SELECT policy to the row it hands back,
  // and entities_read requires a row in entity_access — which the AFTER INSERT
  // trigger only creates once the insert has happened. RETURNING is evaluated
  // first, so the read-back was denied and the whole statement rolled back,
  // reporting an RLS violation on the insert that had in fact succeeded.
  //
  // We already know the slug. Asking the database to tell us was never needed.
  let slug = String(row.slug);
  let { error } = await supabase.from('entities').insert(row);

  // 23505: the slug is taken. Disambiguate rather than failing in the user's face.
  if (error?.code === '23505') {
    slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
    ({ error } = await supabase.from('entities').insert({ ...row, slug }));
  }
  if (error) throw new Error(error.message);

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}`);
}

/**
 * Edit an entity's details.
 *
 * The slug is deliberately NOT recomputed from a changed name. It is the
 * address of every link, bookmark and browser tab pointing at this entity, and
 * silently moving it to punish a typo correction is not a trade worth making.
 * The displayed name changes; the address does not.
 *
 * Type is not editable either. A company and an individual are charged
 * different taxes and generate different obligations, and the returns already
 * filed under one reading would be nonsense under the other.
 */
export async function updateEntity(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get('id'));
  const slug = String(formData.get('slug'));
  const type = String(formData.get('type')) as 'company' | 'individual';
  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Name is required');

  const row: Record<string, unknown> = { name };

  if (type === 'company') {
    row.company_number = String(formData.get('company_number') ?? '') || null;
    row.utr = String(formData.get('utr') ?? '') || null;
    row.year_end_month = Number(formData.get('year_end_month')) || 3;
    row.year_end_day = Number(formData.get('year_end_day')) || 31;
    row.trading_status = String(formData.get('trading_status') ?? 'trading');
    row.vat_registered = formData.get('vat_registered') === 'on';
    row.vrn = String(formData.get('vrn') ?? '') || null;
    row.vat_stagger = String(formData.get('vat_stagger') ?? '3');
    row.is_close_investment_holding_company = formData.get('cihc') === 'on';
  } else {
    row.utr = String(formData.get('utr') ?? '') || null;
    row.ni_number = String(formData.get('ni_number') ?? '') || null;
  }

  const { error } = await supabase.from('entities').update(row).eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}`);
}

/**
 * Archive rather than delete.
 *
 * Deleting an entity cascades through returns, liabilities, payments, payroll
 * and properties — the whole record of what was filed and paid. A company that
 * has been struck off still has years in which HMRC can enquire, so the record
 * is set aside, not destroyed.
 */
export async function archiveEntity(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from('entities')
    .update({ active: false })
    .eq('id', String(formData.get('id')));
  if (error) throw new Error(error.message);

  revalidatePath('/', 'layout');
  redirect('/');
}
