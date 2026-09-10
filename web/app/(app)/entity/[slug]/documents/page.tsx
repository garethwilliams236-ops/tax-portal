import { notFound } from 'next/navigation';
import { getEntityBySlug } from '@/lib/db/queries';
import { slotsFor } from '@/lib/db/slots';
import {
  getDocuments, filtersOf, applyFilter, humanSize,
  CATEGORIES, CATEGORY_LABEL, type DocumentRow,
} from '@/lib/db/documents';
import { uploadDocuments, updateDocument, deleteDocument, downloadDocument } from '@/lib/actions/documents';
import { fmtD, TAX_LABEL } from '@/lib/format';
import { EntityHeader } from '../nav';

export const dynamic = 'force-dynamic';

const TAXES = ['CT', 'VAT', 'PAYE', 'SA', 'CGT', 'MTD_ITSA', 'CGT_60DAY', 'IHT', 'SDLT', 'OTHER'];
const TAX_NAME = (t: string) => TAX_LABEL[t] ?? t.replace(/_/g, ' ');

export default async function DocumentsPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ category?: string; tax?: string; period?: string; source?: string }>;
}) {
  const { slug } = await params;
  const f = await searchParams;
  const asAt = new Date();

  const entity = await getEntityBySlug(slug);
  if (!entity) notFound();

  const all = await getDocuments(entity.id);
  const shown = applyFilter(all, f);
  const present = filtersOf(all);

  // Real period keys, so a document is filed against a period that exists
  // rather than a typed string that will never match one.
  const periods = [...new Set(slotsFor(entity, asAt).map((s) => s.periodKey))];

  const q = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : '?';
  };

  return (
    <>
      <EntityHeader entity={entity} active="documents" />

      <h3 className="mb-2 mt-6 text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        File something
      </h3>

      <form action={uploadDocuments} encType="multipart/form-data" className="tw p-4">
        <input type="hidden" name="entity_id" value={entity.id} />
        <input type="hidden" name="slug" value={slug} />

        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>What it is</span>
            <select name="category" className="input" defaultValue="">
              <option value="">Unfiled</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>Tax</span>
            <select name="tax_type" className="input" defaultValue="">
              <option value="">Not about one</option>
              {TAXES.map((t) => <option key={t} value={t}>{TAX_NAME(t)}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>Period</span>
            <input name="period_label" className="input" list="periods" placeholder="optional" />
            <datalist id="periods">
              {periods.map((k) => <option key={k} value={k} />)}
            </datalist>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>File</span>
            <input name="files" type="file" multiple required className="input"
              accept=".pdf,.jpg,.jpeg,.png,.heic,.tif,.tiff,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.eml" />
          </label>
        </div>

        <div className="mt-4 flex items-center gap-3 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
          <button className="btn btn-pri" type="submit">Upload</button>
          <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
            Up to 25 MB each. Held in a private store and reached only through a link that expires in a
            minute. Nothing is kept in this browser.
          </span>
        </div>
      </form>

      {/* ------------------------------------------------------------------ */}
      <div className="mb-2 mt-7 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          Filed
        </h3>
        <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
          {shown.length === all.length ? `${all.length}` : `${shown.length} of ${all.length}`}
        </span>
        <span className="flex-1" />
        <Chip href={q({ category: undefined, tax: undefined, period: undefined, source: undefined })}
          on={!f.category && !f.tax && !f.period && !f.source} label="All" />
        <Chip href={q({ source: f.source === 'letter' ? undefined : 'letter' })}
          on={f.source === 'letter'} label="From a letter" />
        <Chip href={q({ source: f.source === 'filed' ? undefined : 'filed' })}
          on={f.source === 'filed'} label="Filed directly" />
      </div>

      {(present.categories.length > 0 || present.taxes.length > 0 || present.periods.length > 0) && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {present.categories.map((c) => (
            <Chip key={c} href={q({ category: f.category === c ? undefined : c })}
              on={f.category === c} label={CATEGORY_LABEL[c]} />
          ))}
          {present.taxes.map((t) => (
            <Chip key={t} href={q({ tax: f.tax === t ? undefined : t })}
              on={f.tax === t} label={TAX_NAME(t)} />
          ))}
          {present.periods.map((p) => (
            <Chip key={p} href={q({ period: f.period === p ? undefined : p })}
              on={f.period === p} label={p} />
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="tw px-4 py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
          {all.length === 0 ? 'Nothing filed yet.' : 'Nothing matches those filters.'}
        </div>
      ) : (
        <div className="tw">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wider"
                style={{ color: 'var(--muted)', background: 'var(--panel2)' }}>
                <th className="px-4 py-2 font-semibold">File</th>
                <th className="px-4 py-2 font-semibold">What it is</th>
                <th className="px-4 py-2 font-semibold">About</th>
                <th className="px-4 py-2 font-semibold">Added</th>
                <th className="px-4 py-2 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => (
                <Row key={d.id} doc={d} slug={slug} periods={periods} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Chip({ href, on, label }: { href: string; on: boolean; label: string }) {
  return (
    <a href={href} className="rounded-md border px-2.5 py-1 text-[11.5px] font-medium"
      style={{
        borderColor: on ? 'var(--accent)' : 'var(--line)',
        borderWidth: on ? 2 : 1,
        background: on ? 'var(--accent-bg)' : 'var(--panel)',
        color: on ? 'var(--ink)' : 'var(--muted)',
      }}>
      {label}
    </a>
  );
}

function Row({ doc, slug, periods }: { doc: DocumentRow; slug: string; periods: string[] }) {
  return (
    <tr className="border-t align-top" style={{ borderColor: 'var(--line2)' }}>
      <td className="px-4 py-2">
        <form action={downloadDocument}>
          <input type="hidden" name="id" value={doc.id} />
          <button type="submit" className="font-medium underline" title={doc.contentType ?? undefined}>
            {doc.fileName}
          </button>
        </form>
        <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>
          {humanSize(doc.sizeBytes)}
        </span>
      </td>

      <td className="px-4 py-2">
        {doc.category
          ? CATEGORY_LABEL[doc.category]
          : <span style={{ color: 'var(--muted)' }}>unfiled</span>}
        {doc.correspondenceId && (
          <a href={`/entity/${slug}/correspondence#c-${doc.correspondenceId}`}
            className="mt-0.5 block text-[11.5px] underline" style={{ color: 'var(--muted)' }}>
            from “{doc.correspondenceSubject ?? 'a letter'}”
          </a>
        )}
      </td>

      <td className="px-4 py-2">
        {doc.taxType || doc.periodLabel ? (
          <>
            {doc.taxType && TAX_NAME(doc.taxType)}
            {doc.periodLabel && (
              <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>{doc.periodLabel}</span>
            )}
          </>
        ) : (
          <span style={{ color: 'var(--muted)' }}>—</span>
        )}
      </td>

      <td className="whitespace-nowrap px-4 py-2" style={{ color: 'var(--muted)' }}>
        {fmtD(doc.uploadedAt)}
      </td>

      <td className="px-4 py-2">
        <details>
          <summary className="btn cursor-pointer text-[12px]">Edit</summary>

          {/* Only the filing labels are editable. The file is what it is. */}
          <form action={updateDocument} className="mt-2 w-[260px] space-y-2 rounded-lg border p-3"
            style={{ borderColor: 'var(--line)' }}>
            <input type="hidden" name="id" value={doc.id} />
            <input type="hidden" name="slug" value={slug} />
            <select name="category" className="input" defaultValue={doc.category ?? ''}>
              <option value="">Unfiled</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
            <select name="tax_type" className="input" defaultValue={doc.taxType ?? ''}>
              <option value="">Not about one</option>
              {TAXES.map((t) => <option key={t} value={t}>{TAX_NAME(t)}</option>)}
            </select>
            <input name="period_label" className="input" list="periods"
              defaultValue={doc.periodLabel ?? ''} placeholder="Period" />
            <datalist id="periods">
              {periods.map((k) => <option key={k} value={k} />)}
            </datalist>
            <button className="btn btn-pri w-full text-[12px]" type="submit">Save</button>
          </form>

          <form action={deleteDocument} className="mt-2 w-[260px] space-y-2 rounded-lg border p-3"
            style={{ borderColor: 'var(--line)' }}>
            <input type="hidden" name="id" value={doc.id} />
            <input type="hidden" name="slug" value={slug} />
            <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
              {doc.correspondenceId
                ? 'This is an attachment on a letter. Deleting it removes it from that letter too.'
                : 'Removes the file permanently. There is no undo.'}
            </p>
            <button className="btn w-full text-[12px]" type="submit" style={{ color: 'var(--crit)' }}>
              Delete
            </button>
          </form>
        </details>
      </td>
    </tr>
  );
}
