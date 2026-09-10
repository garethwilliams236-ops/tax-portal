'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { storeFile, removeFile, signedUrlFor } from '@/lib/db/storage';
import { CATEGORIES } from '@/lib/db/documents';

/**
 * Filing a document against an entity.
 *
 * Every write reads its own entity id out of the form and lets row-level
 * security decide. There is no elevated client anywhere on this path: if the
 * signed-in user cannot write to the entity, the insert fails in the database
 * rather than in a check that could be forgotten.
 */

const TAXES = ['CT', 'VAT', 'PAYE', 'SA', 'CGT', 'MTD_ITSA', 'CGT_60DAY', 'IHT', 'SDLT', 'OTHER'];

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const orNull = (v: string) => (v === '' ? null : v);

function checked(v: string | null, allowed: readonly string[], what: string) {
  if (v !== null && !allowed.includes(v)) throw new Error(`${what}: "${v}" is not one of ${allowed.join(', ')}.`);
  return v;
}

export async function uploadDocuments(formData: FormData) {
  const entityId = str(formData, 'entity_id');
  const slug = str(formData, 'slug');

  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) throw new Error('No file was chosen.');

  const opts = {
    category: checked(orNull(str(formData, 'category')), CATEGORIES, 'Category'),
    taxType: checked(orNull(str(formData, 'tax_type')), TAXES, 'Tax'),
    periodLabel: orNull(str(formData, 'period_label')),
  };

  for (const file of files) await storeFile(entityId, file, opts);

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}/documents`);
}

/**
 * Change what a document is ABOUT.
 *
 * Not the file — the file is what it is. This edits the category, the tax and
 * the period, which are the portal's own filing labels and the only part of a
 * document it is ever right to change after the fact.
 */
export async function updateDocument(formData: FormData) {
  const supabase = await createClient();
  const id = str(formData, 'id');
  const slug = str(formData, 'slug');

  const { error } = await supabase
    .from('documents')
    .update({
      category: checked(orNull(str(formData, 'category')), CATEGORIES, 'Category'),
      tax_type: checked(orNull(str(formData, 'tax_type')), TAXES, 'Tax'),
      period_label: orNull(str(formData, 'period_label')),
    })
    .eq('id', id);
  if (error) throw new Error(`document: ${error.message}`);

  revalidatePath('/', 'layout');
  redirect(str(formData, 'back') || `/entity/${slug}/documents`);
}

export async function deleteDocument(formData: FormData) {
  await removeFile(str(formData, 'id'));
  revalidatePath('/', 'layout');
  redirect(str(formData, 'back') || `/entity/${str(formData, 'slug')}/documents`);
}

/**
 * Hand back a document.
 *
 * The signed URL is minted here, lives for a minute, and is redirected to
 * rather than rendered into the page — so it is never in the markup, never in
 * the history as a working link, and cannot be shared by copying it later.
 */
export async function downloadDocument(formData: FormData) {
  redirect(await signedUrlFor(str(formData, 'id'), 60));
}
