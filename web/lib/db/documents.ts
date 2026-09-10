import { createClient } from '@/lib/supabase/server';

/**
 * Everything filed against an entity.
 *
 * One store, two doors. A scan attached to a letter and a set of accounts
 * filed directly are the same row in the same table; what differs is what they
 * are ABOUT. So this reads them all, and says which arrived through a letter —
 * hiding those would mean the Documents tab quietly failed to list half the
 * documents.
 */

export type DocumentCategory =
  | 'return' | 'computation' | 'accounts' | 'hmrc_notice' | 'deed' | 'evidence' | 'other';

export const CATEGORIES: DocumentCategory[] = [
  'accounts', 'computation', 'return', 'hmrc_notice', 'deed', 'evidence', 'other',
];

export const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  accounts: 'Accounts',
  computation: 'Computation',
  return: 'Return',
  hmrc_notice: 'HMRC notice',
  deed: 'Deed',
  evidence: 'Evidence',
  other: 'Other',
};

export interface DocumentRow {
  id: string;
  entityId: string;
  category: DocumentCategory | null;
  taxType: string | null;
  periodLabel: string | null;
  fileName: string;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedAt: Date;
  /** Set when the file arrived as an attachment to a letter. */
  correspondenceId: string | null;
  correspondenceSubject: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function getDocuments(entityId: string): Promise<DocumentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('documents')
    .select('id, entity_id, category, tax_type, period_label, filename, content_type, size_bytes, uploaded_at, correspondence_id, correspondence(subject)')
    .eq('entity_id', entityId)
    .order('uploaded_at', { ascending: false });
  if (error) throw new Error(`documents: ${error.message}`);

  return (data ?? []).map((r: any): DocumentRow => ({
    id: r.id,
    entityId: r.entity_id,
    category: r.category ?? null,
    taxType: r.tax_type ?? null,
    periodLabel: r.period_label ?? null,
    fileName: r.filename,
    contentType: r.content_type ?? null,
    sizeBytes: r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes),
    uploadedAt: new Date(r.uploaded_at),
    correspondenceId: r.correspondence_id ?? null,
    correspondenceSubject: r.correspondence?.subject ?? null,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Documents filed against one tax and period.
 *
 * Matches on BOTH, so a document filed against Corporation Tax generally —
 * with no period — does not appear on every period's screen pretending to
 * belong there.
 */
export function docsFor(
  docs: DocumentRow[], taxType: string, periodKey: string,
): DocumentRow[] {
  return docs.filter((d) => d.taxType === taxType && d.periodLabel === periodKey);
}

/** The filters the screen offers, built from what is actually there. */
export function filtersOf(docs: DocumentRow[]) {
  return {
    categories: [...new Set(docs.map((d) => d.category).filter(Boolean))] as DocumentCategory[],
    taxes: [...new Set(docs.map((d) => d.taxType).filter(Boolean))] as string[],
    periods: [...new Set(docs.map((d) => d.periodLabel).filter(Boolean))] as string[],
  };
}

export function applyFilter(
  docs: DocumentRow[],
  f: { category?: string; tax?: string; period?: string; source?: string },
): DocumentRow[] {
  return docs.filter((d) => {
    if (f.category && d.category !== f.category) return false;
    if (f.tax && d.taxType !== f.tax) return false;
    if (f.period && d.periodLabel !== f.period) return false;
    if (f.source === 'letter' && !d.correspondenceId) return false;
    if (f.source === 'filed' && d.correspondenceId) return false;
    return true;
  });
}

export const humanSize = (bytes: number | null) =>
  bytes === null ? ''
    : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
