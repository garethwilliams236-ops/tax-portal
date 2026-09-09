import { createClient } from '@/lib/supabase/server';

/**
 * Correspondence, and the documents attached to it.
 *
 * "Overdue" is computed here from the follow-up date and the resolution, never
 * read from a column. The ledger works the same way for the same reason: a
 * stored status is a second copy of a fact, and the two drift.
 */

export type Direction = 'from_hmrc' | 'to_hmrc' | 'note';
export type Channel = 'letter' | 'phone' | 'email' | 'online' | 'form' | 'other';

export interface CorrespondenceFile {
  id: string;
  storagePath: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedAt: Date;
}

export interface CorrespondenceItem {
  id: string;
  entityId: string;
  happenedOn: Date;
  direction: Direction;
  channel: Channel;
  subject: string;
  body: string | null;
  hmrcReference: string | null;
  contact: string | null;
  taxType: string | null;
  periodKey: string | null;
  respondBy: Date | null;
  resolvedAt: Date | null;
  resolution: string | null;
  files: CorrespondenceFile[];
}

const d = (s: string | null): Date | null => (s ? new Date(s + 'T00:00:00.000Z') : null);

const SELECT =
  'id, entity_id, happened_on, direction, channel, subject, body, hmrc_reference, contact, ' +
  'tax_type, period_key, respond_by, resolved_at, resolution, ' +
  'correspondence_files(id, storage_path, file_name, content_type, size_bytes, uploaded_at)';

/* eslint-disable @typescript-eslint/no-explicit-any */
function toItem(r: any): CorrespondenceItem {
  return {
    id: r.id,
    entityId: r.entity_id,
    happenedOn: d(r.happened_on)!,
    direction: r.direction,
    channel: r.channel,
    subject: r.subject,
    body: r.body ?? null,
    hmrcReference: r.hmrc_reference ?? null,
    contact: r.contact ?? null,
    taxType: r.tax_type ?? null,
    periodKey: r.period_key ?? null,
    respondBy: d(r.respond_by),
    resolvedAt: r.resolved_at ? new Date(r.resolved_at) : null,
    resolution: r.resolution ?? null,
    files: (r.correspondence_files ?? [])
      .map((f: any): CorrespondenceFile => ({
        id: f.id,
        storagePath: f.storage_path,
        fileName: f.file_name,
        contentType: f.content_type ?? null,
        sizeBytes: f.size_bytes === null ? null : Number(f.size_bytes),
        uploadedAt: new Date(f.uploaded_at),
      }))
      .sort((a: CorrespondenceFile, b: CorrespondenceFile) =>
        a.uploadedAt.getTime() - b.uploadedAt.getTime()),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function getCorrespondence(entityId: string): Promise<CorrespondenceItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('correspondence')
    .select(SELECT)
    .eq('entity_id', entityId)
    .order('happened_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(`correspondence: ${error.message}`);
  return (data ?? []).map(toItem);
}

/** Still needing action: no resolution recorded. */
export const isOpen = (i: CorrespondenceItem) => i.resolvedAt === null && i.respondBy !== null;

/** Open, and the date to act by has passed. Arithmetic, not a status. */
export function isOverdue(i: CorrespondenceItem, asAt: Date): boolean {
  if (!isOpen(i)) return false;
  return i.respondBy!.getTime() < Date.UTC(asAt.getUTCFullYear(), asAt.getUTCMonth(), asAt.getUTCDate());
}

/** Open items, soonest first — what the entity screen leads with. */
export function openItems(items: CorrespondenceItem[]): CorrespondenceItem[] {
  return items
    .filter(isOpen)
    .sort((a, b) => a.respondBy!.getTime() - b.respondBy!.getTime());
}

/** The items filed against one tax and period, for that period's screen. */
export function itemsFor(
  items: CorrespondenceItem[], taxType: string, periodKey: string,
): CorrespondenceItem[] {
  return items.filter((i) => i.taxType === taxType && i.periodKey === periodKey);
}

/**
 * A short-lived URL for one attachment.
 *
 * The bucket is private, so this is the only way to read an object, and the
 * link stops working within the minute. Nothing is ever handed a permanent
 * address, and no file is stored in the browser beyond the download itself.
 */
export async function signedFileUrl(storagePath: string, seconds = 60): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from('correspondence')
    .createSignedUrl(storagePath, seconds, { download: true });
  if (error) throw new Error(`correspondence file: ${error.message}`);
  return data.signedUrl;
}
