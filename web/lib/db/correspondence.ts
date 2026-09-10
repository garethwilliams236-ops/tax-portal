import { createClient } from '@/lib/supabase/server';

/**
 * Correspondence, and the documents attached to it.
 *
 * The column names are 0001's — `occurred_on`, `counterparty`, `summary`,
 * `response_due`, `response_status`, `filename`. They are mapped to friendlier
 * property names here, once, rather than renamed in the database to suit newer
 * code.
 *
 * "Overdue" is arithmetic against today. There is no stored `is_overdue`, and
 * deliberately no second column duplicating `response_status`: the ledger works
 * the same way, because a stored answer and a computed one eventually disagree.
 */

export type Direction = 'inbound' | 'outbound' | 'note';
export type Channel = 'letter' | 'email' | 'phone' | 'portal' | 'form' | 'other';
export type ResponseStatus = 'none' | 'pending' | 'sent' | 'closed';

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
  occurredOn: Date;
  direction: Direction;
  channel: Channel;
  subject: string;
  summary: string | null;
  hmrcReference: string | null;
  counterparty: string | null;
  taxType: string | null;
  periodKey: string | null;
  responseDue: Date | null;
  responseStatus: ResponseStatus;
  resolution: string | null;
  files: CorrespondenceFile[];
}

const d = (s: string | null): Date | null => (s ? new Date(s + 'T00:00:00.000Z') : null);

const SELECT =
  'id, entity_id, occurred_on, direction, channel, subject, summary, hmrc_reference, ' +
  'counterparty, tax_type, period_key, response_due, response_status, resolution, ' +
  'documents(id, storage_path, filename, content_type, size_bytes, uploaded_at)';

/* eslint-disable @typescript-eslint/no-explicit-any */
function toItem(r: any): CorrespondenceItem {
  return {
    id: r.id,
    entityId: r.entity_id,
    occurredOn: d(r.occurred_on)!,
    direction: r.direction,
    channel: r.channel,
    subject: r.subject,
    summary: r.summary ?? null,
    hmrcReference: r.hmrc_reference ?? null,
    counterparty: r.counterparty ?? null,
    taxType: r.tax_type ?? null,
    periodKey: r.period_key ?? null,
    responseDue: d(r.response_due),
    responseStatus: (r.response_status ?? 'none') as ResponseStatus,
    resolution: r.resolution ?? null,
    files: (r.documents ?? [])
      .map((f: any): CorrespondenceFile => ({
        id: f.id,
        storagePath: f.storage_path,
        fileName: f.filename,
        contentType: f.content_type ?? null,
        sizeBytes: f.size_bytes === null || f.size_bytes === undefined ? null : Number(f.size_bytes),
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
    .order('occurred_on', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw new Error(`correspondence: ${error.message}`);
  return (data ?? []).map(toItem);
}

/**
 * Still waiting on you: a response is due and the matter is not closed.
 *
 * 'sent' does NOT close it. A reply posted to HMRC is not the same as the
 * thing being over, and treating it as such is how something gets forgotten
 * for the six weeks before they write back.
 */
export const isOpen = (i: CorrespondenceItem) =>
  i.responseDue !== null && i.responseStatus !== 'closed';

/** Open, and the date to act by has passed. Arithmetic, not a status. */
export function isOverdue(i: CorrespondenceItem, asAt: Date): boolean {
  if (!isOpen(i)) return false;
  const today = Date.UTC(asAt.getUTCFullYear(), asAt.getUTCMonth(), asAt.getUTCDate());
  return i.responseDue!.getTime() < today;
}

/** Open items, soonest first — what the screen leads with. */
export function openItems(items: CorrespondenceItem[]): CorrespondenceItem[] {
  return items
    .filter(isOpen)
    .sort((a, b) => a.responseDue!.getTime() - b.responseDue!.getTime());
}

/** The items filed against one tax and period, for that period's screen. */
export function itemsFor(
  items: CorrespondenceItem[], taxType: string, periodKey: string,
): CorrespondenceItem[] {
  return items.filter((i) => i.taxType === taxType && i.periodKey === periodKey);
}
