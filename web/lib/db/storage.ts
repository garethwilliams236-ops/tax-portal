import { createClient } from '@/lib/supabase/server';

/**
 * Putting a file into the private store, and getting one back out.
 *
 * Shared by correspondence attachments and by documents filed directly against
 * an entity, because they are the SAME thing: one `documents` row and one
 * object in one private bucket. A letter's scan and a set of accounts differ
 * in what they are about, not in how they are held.
 *
 * Not a server action. These are called BY actions, so exporting them here
 * keeps them off the network: a 'use server' module publishes every export as
 * an endpoint, and an upload helper taking a raw entity id has no business
 * being one.
 */

export const BUCKET = 'documents';

/** 25 MB. A scanned HMRC letter is a few hundred KB; a set of accounts, less. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * What may be stored. Anything else is refused rather than kept: the bucket is
 * private and served through signed URLs, but a file the portal cannot hand
 * back cleanly has no business being in it.
 */
export const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/heic', 'image/tiff', 'image/webp',
  'text/plain', 'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'message/rfc822',
]);

export interface StoreOptions {
  /** The letter this belongs to, where it belongs to one. */
  correspondenceId?: string | null;
  category?: string | null;
  taxType?: string | null;
  periodLabel?: string | null;
}

/**
 * Store one file and record it.
 *
 * The object key starts with the entity id because that is the segment the
 * storage policy tests — `storage.foldername(name)[1]` — so a file cannot be
 * reached by anyone who cannot read the entity. The rest of the key is opaque:
 * the uploaded name is a LABEL held in the row, never part of a path, so a
 * file called "../../etc/passwd" is a label and not a location.
 */
export async function storeFile(entityId: string, file: File, opts: StoreOptions = {}) {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 25 MB.`);
  }
  const type = file.type || 'application/octet-stream';
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error(`${file.name} is a ${type}, which the portal does not accept. PDFs, images, Office documents and plain text are fine.`);
  }

  const supabase = await createClient();
  const folder = opts.correspondenceId ?? 'general';
  const storagePath = `${entityId}/${folder}/${crypto.randomUUID()}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { contentType: type, upsert: false });
  if (uploadError) throw new Error(`upload: ${uploadError.message}`);

  const { error } = await supabase.from('documents').insert({
    entity_id: entityId,
    correspondence_id: opts.correspondenceId ?? null,
    category: opts.category ?? null,
    tax_type: opts.taxType ?? null,
    period_label: opts.periodLabel ?? null,
    storage_path: storagePath,
    filename: file.name,
    content_type: type,
    size_bytes: file.size,
  });
  if (error) {
    // Do not leave an object nothing points at.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw new Error(`document: ${error.message}`);
  }
}

/**
 * Remove one document, object first.
 *
 * A row without its object is a broken link you can see. An object without its
 * row is a file nobody can ever reach or remove, so it goes first.
 */
export async function removeFile(documentId: string) {
  const supabase = await createClient();

  const { data, error: readError } = await supabase
    .from('documents').select('storage_path').eq('id', documentId).single();
  if (readError) throw new Error(`document: ${readError.message}`);

  const { error: removeError } = await supabase.storage
    .from(BUCKET).remove([data.storage_path as string]);
  if (removeError) throw new Error(`document: ${removeError.message}`);

  const { error } = await supabase.from('documents').delete().eq('id', documentId);
  if (error) throw new Error(`document: ${error.message}`);
}

/**
 * A short-lived URL for one file.
 *
 * The bucket is private, so this is the only way to read an object at all, and
 * the link stops working within the minute. Nothing is ever handed a permanent
 * address, and no file is stored in the browser beyond the download itself.
 */
export async function signedUrlFor(documentId: string, seconds = 60): Promise<string> {
  const supabase = await createClient();

  // Read through the TABLE, not the bucket: row-level security on this row is
  // what decides whether the caller may have the file at all.
  const { data, error } = await supabase
    .from('documents').select('storage_path').eq('id', documentId).single();
  if (error) throw new Error(`document: ${error.message}`);

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(data.storage_path as string, seconds, { download: true });
  if (signError) throw new Error(`document: ${signError.message}`);
  return signed.signedUrl;
}
