'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

const orNull = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};

export async function addPerson(formData: FormData) {
  const supabase = await createClient();
  const entityId = String(formData.get('entity_id'));
  const slug = String(formData.get('slug'));
  const taxYear = String(formData.get('tax_year'));
  const name = String(formData.get('name') ?? '').trim();
  if (!name) throw new Error('Enter a name.');

  const { error } = await supabase.from('payroll_people').insert({
    entity_id: entityId,
    name,
    is_director: formData.get('is_director') === 'on',
    directorship_started_on: orNull(formData.get('directorship_started_on')),
    started_on: orNull(formData.get('started_on')),
  });
  if (error) {
    if (error.code === '23505') throw new Error(`${name} is already on this payroll.`);
    throw new Error(`payroll: ${error.message}`);
  }

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}/payroll?year=${encodeURIComponent(taxYear)}`);
}

/**
 * Save pay for ONE tax year.
 *
 * The tax year is not optional and is part of the unique key, so a figure
 * cannot be written without saying which year it belongs to.
 */
export async function savePay(formData: FormData) {
  const supabase = await createClient();
  const slug = String(formData.get('slug'));
  const taxYear = String(formData.get('tax_year'));
  const personId = String(formData.get('person_id'));
  if (!taxYear) throw new Error('No tax year — refusing to save a figure with no year on it.');

  const { error } = await supabase.from('payroll_pay').upsert(
    {
      person_id: personId,
      tax_year: taxYear,
      annual_pay: Number(formData.get('annual_pay') ?? 0) || 0,
      benefits_in_kind: Number(formData.get('benefits_in_kind') ?? 0) || 0,
      notes: orNull(formData.get('notes')),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'person_id,tax_year' },
  );
  if (error) throw new Error(`pay: ${error.message}`);

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}/payroll?year=${encodeURIComponent(taxYear)}`);
}

export async function removePerson(formData: FormData) {
  const supabase = await createClient();
  const slug = String(formData.get('slug'));
  const taxYear = String(formData.get('tax_year'));
  const { error } = await supabase
    .from('payroll_people')
    .delete()
    .eq('id', String(formData.get('person_id')));
  if (error) throw new Error(`payroll: ${error.message}`);

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}/payroll?year=${encodeURIComponent(taxYear)}`);
}
