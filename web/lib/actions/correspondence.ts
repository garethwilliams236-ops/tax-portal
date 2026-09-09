'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { signedFileUrl } from '@/lib/db/correspondence';

/**
 * Recording correspondence, and attaching the documents to it.
 *
 * Every write reads its own entity id out of the form and lets row-level
 * security decide. There is no elevated client anywhere on this path: if the
 * signed-in user cannot write to the entity, the insert fails in the database,
 * not in a check that could be forgotten.
 */

const DIRECTIONS = ['inbound', 'outbound', 'note'] as const;
const CHANNELS = ['letter', 'email', 'phone', 'portal', 'form', 'other'] as const;
const TAXES = ['CT', 'VAT', 'PAYE', 'SA', 'CGT', 'MTD_ITSA', 'CGT_60DAY', 'IHT', 'SDLT', 'OTHER'] as const;

/** 25 MB. A scanned HMRC letter is a few hundred KB; this is generous. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * What a browser may hand us. Anything else is refused rather than stored:
 * the bucket is private and served through signed URLs, but a file the portal
 * cannot render or hand back cleanly has no business being in it.
 */
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/heic', 'image/tiff', 'image/webp',
  'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'message/rfc822',
]);

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const orNull = (v: string) => (v === '' ? null : v);

function oneOf<T extends readonly string[]>(v: string, allowed: T, what: string): T[number] {
  if (!(allowed as readonly string[]).includes(v)) throw new Error(`${what}: "${v}" is not one of ${allowed.join(', ')}.`);
  return v;
}

export async function saveCorrespondence(formData: FormData) {
  const supabase = await createClient();

  const id = str(formData, 'id');
  const entityId = str(formData, 'entity_id');
  const slug = str(formData, 'slug');

  const subject = str(formData, 'subject');
  if (!subject) throw new Error('A subject is needed — it is what you will scan the list for.');

  const occurredOn = str(formData, 'occurred_on');
  if (!occurredOn) throw new Error('The date it happened is needed.');

  const row = {
    entity_id: entityId,
    occurred_on: occurredOn,
    direction: oneOf(str(formData, 'direction'), DIRECTIONS, 'Direction'),
    channel: oneOf(str(formData, 'channel') || 'letter', CHANNELS, 'Channel'),
    subject,
    summary: orNull(str(formData, 'summary')),
    hmrc_reference: orNull(str(formData, 'hmrc_reference')),
    counterparty: orNull(str(formData, 'counterparty')),
    tax_type: orNull(str(formData, 'tax_type'))
      ? oneOf(str(formData, 'tax_type'), TAXES, 'Tax') : null,
    period_key: orNull(str(formData, 'period_key')),
    response_due: orNull(str(formData, 'response_due')),
  };

  let correspondenceId = id;

  if (id) {
    const { error } = await supabase.from('correspondence').update(row).eq('id', id);
    if (error) throw new Error(`correspondence: ${error.message}`);
  } else {
    const { data, error } = await supabase.from('correspondence').insert(row).select('id').single();
    if (error) throw new Error(`correspondence: ${error.message}`);
    correspondenceId = data.id;
  }

  // Attachments come in on the same form as the item they belong to, so a
  // letter and its scan are recorded in one action rather than two.
  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  for (const file of files) {
    await storeFile(entityId, correspondenceId, file);
  }

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}/correspondence`);
}

/**
  * Mark an item dealt with — or reopen it.
  *
  * `response_status` is the single answer to "is this still live". There is no
  * second column holding the same fact, so there is nothing to keep in step.
  */
export async function resolveCorrespondence(formData: FormData) {
  const supabase = await createClient();
  const id = str(formData, 'id');
  const slug = str(formData, 'slug');
  const reopen = str(formData, 'reopen') === '1';

  // 'sent' means a reply went out and the matter is still live — which is the
  // state most things are in for the six weeks before HMRC write back, and the
  // one most easily lost by treating "I answered it" as "it is over".
  const status = reopen ? 'pending' : (str(formData, 'status') || 'closed');
  oneOf(status, ['pending', 'sent', 'closed'] as const, 'Status');

  const { error } = await supabase
    .from('correspondence')
    .update({
      response_status: status,
      resolution: status === 'closed' ? orNull(str(formData, 'resolution')) : null,
    })
    .eq('id', id);
  if (error) throw new Error(`correspondence: ${error.message}`);

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}/correspondence`);
}

export async function deleteCorrespondence(formData: FormData) {
  const supabase = await createClient();
  const id = str(formData, 'id');
  const slug = str(formData, 'slug');

  // The rows cascade, but the objects in the bucket do not — a database
  // delete leaves the files behind unless they are removed first.
  const { data: files } = await supabase
    .from('documents').select('storage_path').eq('correspondence_id', id);
  const paths = (files ?? []).map((f) => f.storage_path as string);
  if (paths.length) await supabase.storage.from('documents').remove(paths);

  const { error } = await supabase.from('correspondence').delete().eq('id', id);
  if (error) throw new Error(`correspondence: ${error.message}`);

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}/correspondence`);
}

export async function addCorrespondenceFile(formData: FormData) {
  const entityId = str(formData, 'entity_id');
  const correspondenceId = str(formData, 'correspondence_id');
  const slug = str(formData, 'slug');

  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) throw new Error('No file was chosen.');
  for (const file of files) await storeFile(entityId, correspondenceId, file);

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}/correspondence`);
}

export async function deleteCorrespondenceFile(formData: FormData) {
  const supabase = await createClient();
  const fileId = str(formData, 'file_id');
  const slug = str(formData, 'slug');

  const { data, error: readError } = await supabase
    .from('documents').select('storage_path').eq('id', fileId).single();
  if (readError) throw new Error(`document: ${readError.message}`);

  // Object first: a row without its object is a broken link you can see, and
  // an object without its row is a file nobody can ever reach or remove.
  const { error: removeError } = await supabase.storage
    .from('documents').remove([data.storage_path as string]);
  if (removeError) throw new Error(`document: ${removeError.message}`);

  const { error } = await supabase.from('documents').delete().eq('id', fileId);
  if (error) throw new Error(`document: ${error.message}`);

  revalidatePath('/', 'layout');
  redirect(`/entity/${slug}/correspondence`);
}

/**
 * Hand back a document.
 *
 * The signed URL is minted here, lives for a minute, and is redirected to
 * rather than rendered into the page — so it is never in the markup, never in
 * the history as a working link, and cannot be shared by copying it later.
 */
export async function downloadCorrespondenceFile(formData: FormData) {
  const supabase = await createClient();
  const fileId = str(formData, 'file_id');

  // Read through the table, not the bucket: RLS on this row is what decides
  // whether the caller may have the file at all.
  const { data, error } = await supabase
    .from('documents').select('storage_path').eq('id', fileId).single();
  if (error) throw new Error(`document: ${error.message}`);

  redirect(await signedFileUrl(data.storage_path as string, 60));
}

// ---------------------------------------------------------------------------

async function storeFile(entityId: string, correspondenceId: string, file: File) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 25 MB.`);
  }
  const type = file.type || 'application/octet-stream';
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error(`${file.name} is a ${type}, which the portal does not accept. PDFs, images, Office documents and plain text are fine.`);
  }

  const supabase = await createClient();

  // The path starts with the entity id because that is the segment the storage
  // policy tests. The rest is opaque: the uploaded name is a LABEL stored in
  // the row, never part of a path, so it cannot traverse or collide.
  const objectId = crypto.randomUUID();
  const storagePath = `${entityId}/${correspondenceId}/${objectId}`;

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, { contentType: type, upsert: false });
  if (uploadError) throw new Error(`upload: ${uploadError.message}`);

  const { error } = await supabase.from('documents').insert({
    correspondence_id: correspondenceId,
    entity_id: entityId,
    storage_path: storagePath,
    filename: file.name,
    content_type: type,
    size_bytes: file.size,
  });
  if (error) {
    // Do not leave an object nothing points at.
    await supabase.storage.from('documents').remove([storagePath]);
    throw new Error(`document: ${error.message}`);
  }
}
