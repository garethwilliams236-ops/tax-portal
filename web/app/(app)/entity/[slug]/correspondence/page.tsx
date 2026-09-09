import { notFound } from 'next/navigation';
import { getEntityBySlug } from '@/lib/db/queries';
import { slotsFor } from '@/lib/db/slots';
import {
  getCorrespondence, openItems, isOverdue, isOpen,
  type CorrespondenceItem,
} from '@/lib/db/correspondence';
import {
  saveCorrespondence, resolveCorrespondence, deleteCorrespondence,
  addCorrespondenceFile, deleteCorrespondenceFile, downloadCorrespondenceFile,
} from '@/lib/actions/correspondence';
import { fmtD, daysTo, TAX_LABEL } from '@/lib/format';
import { EntityHeader } from '../nav';

export const dynamic = 'force-dynamic';

const DIRECTION_LABEL: Record<string, string> = {
  inbound: 'From HMRC', outbound: 'To HMRC', note: 'Note',
};
const CHANNELS = ['letter', 'email', 'phone', 'portal', 'form', 'other'];

/** Taxes a letter can be about, including the ones with no computation screen. */
const TAXES = ['CT', 'VAT', 'PAYE', 'SA', 'CGT', 'MTD_ITSA', 'CGT_60DAY', 'IHT', 'SDLT', 'OTHER'];
const TAX_NAME = (t: string) => TAX_LABEL[t] ?? t.replace(/_/g, ' ');

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function CorrespondencePage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ edit?: string; show?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const asAt = new Date();

  const entity = await getEntityBySlug(slug);
  if (!entity) notFound();

  const items = await getCorrespondence(entity.id);
  const open = openItems(items);
  const editing = items.find((i) => i.id === sp.edit) ?? null;

  // Everything by default; ?show=open narrows to what still wants an answer.
  const showing = sp.show === 'open' ? open : items;

  // The periods this entity actually has, so a letter can be filed against a
  // real one rather than a typed string that will never match.
  const slots = slotsFor(entity, asAt);

  return (
    <>
      <EntityHeader entity={entity} active="correspondence" />

      {open.length > 0 && (
        <section className="mt-5">
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            Waiting on you
          </h3>
          <div className="tw divide-y" style={{ borderColor: 'var(--line)' }}>
            {open.map((i) => {
              const late = isOverdue(i, asAt);
              const days = daysTo(i.responseDue!, asAt);
              return (
                <a key={i.id} href={`#c-${i.id}`}
                  className="flex items-baseline gap-3 px-4 py-2.5 text-[13px]"
                  style={{ borderColor: 'var(--line2)' }}>
                  <span className={`pill ${late ? 'pill-crit' : days <= 14 ? 'pill-warn' : 'pill-mute'}`}>
                    {late ? `${Math.abs(days)}d late` : days === 0 ? 'today' : `${days}d`}
                  </span>
                  <span className="font-medium">{i.subject}</span>
                  <span style={{ color: 'var(--muted)' }}>
                    respond by {fmtD(i.responseDue!)}
                    {i.taxType && ` · ${TAX_NAME(i.taxType)}${i.periodKey ? ` ${i.periodKey}` : ''}`}
                  </span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------------------ */}
      <h3 className="mb-2 mt-7 text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        {editing ? 'Edit' : 'Record something'}
      </h3>

      <form action={saveCorrespondence} encType="multipart/form-data" className="tw p-4">
        <input type="hidden" name="entity_id" value={entity.id} />
        <input type="hidden" name="slug" value={slug} />
        {editing && <input type="hidden" name="id" value={editing.id} />}

        <div className="grid gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>Date</span>
            <input name="occurred_on" type="date" required className="input"
              defaultValue={editing ? iso(editing.occurredOn) : iso(asAt)} />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>Direction</span>
            <select name="direction" className="input" defaultValue={editing?.direction ?? 'inbound'}>
              {Object.entries(DIRECTION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>How</span>
            <select name="channel" className="input" defaultValue={editing?.channel ?? 'letter'}>
              {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>Respond by</span>
            <input name="response_due" type="date" className="input"
              defaultValue={editing?.responseDue ? iso(editing.responseDue) : ''} />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>Subject</span>
          <input name="subject" required className="input" defaultValue={editing?.subject ?? ''}
            placeholder="What it is about, as you would search for it in two years" />
        </label>

        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>Tax</span>
            <select name="tax_type" className="input" defaultValue={editing?.taxType ?? ''}>
              <option value="">Not about one</option>
              {TAXES.map((t) => <option key={t} value={t}>{TAX_NAME(t)}</option>)}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>Period</span>
            <input name="period_key" className="input" list="periods"
              defaultValue={editing?.periodKey ?? ''} placeholder="optional" />
            <datalist id="periods">
              {[...new Set(slots.map((s) => s.periodKey))].map((k) => <option key={k} value={k} />)}
            </datalist>
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>HMRC reference</span>
            <input name="hmrc_reference" className="input" defaultValue={editing?.hmrcReference ?? ''} />
          </label>

          <label className="block">
            <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>Officer or office</span>
            <input name="counterparty" className="input" defaultValue={editing?.counterparty ?? ''} />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>What it says, or what was said</span>
          <textarea name="summary" rows={4} className="input" defaultValue={editing?.summary ?? ''} />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-[12px]" style={{ color: 'var(--muted)' }}>
            Attach the letter — PDF, scan or photo. Up to 25 MB each.
          </span>
          <input name="files" type="file" multiple className="input"
            accept=".pdf,.jpg,.jpeg,.png,.heic,.tif,.tiff,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.eml" />
        </label>

        <div className="mt-4 flex items-center gap-3 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
          <button className="btn btn-pri" type="submit">{editing ? 'Save changes' : 'Record it'}</button>
          {editing && <a className="btn" href="?">Cancel</a>}
          <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
            Documents are held in a private store and reached only through a link that expires in a minute.
            Nothing is kept in this browser.
          </span>
        </div>
      </form>

      {/* ------------------------------------------------------------------ */}
      <div className="mb-2 mt-7 flex items-baseline gap-3">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
          The record
        </h3>
        <span className="flex-1" />
        <a className="text-[12px]" href="?" style={{ color: sp.show === 'open' ? 'var(--muted)' : 'var(--ink)' }}>
          All {items.length}
        </a>
        <a className="text-[12px]" href="?show=open" style={{ color: sp.show === 'open' ? 'var(--ink)' : 'var(--muted)' }}>
          Open {open.length}
        </a>
      </div>

      {showing.length === 0 ? (
        <div className="tw px-4 py-10 text-center text-[13px]" style={{ color: 'var(--muted)' }}>
          {items.length === 0 ? 'Nothing recorded yet.' : 'Nothing open.'}
        </div>
      ) : (
        <div className="space-y-3">
          {showing.map((i) => (
            <Item key={i.id} item={i} slug={slug} entityId={entity.id} asAt={asAt} />
          ))}
        </div>
      )}
    </>
  );
}

function Item({
  item, slug, entityId, asAt,
}: {
  item: CorrespondenceItem; slug: string; entityId: string; asAt: Date;
}) {
  const late = isOverdue(item, asAt);
  const open = isOpen(item);

  return (
    <div id={`c-${item.id}`} className="tw p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`pill ${item.direction === 'inbound' ? 'pill-info' : item.direction === 'outbound' ? 'pill-ok' : 'pill-mute'}`}>
          {DIRECTION_LABEL[item.direction]}
        </span>
        <span className="text-[14px] font-semibold">{item.subject}</span>
        <span className="flex-1" />
        <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
          {fmtD(item.occurredOn)} · {item.channel}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px]" style={{ color: 'var(--muted)' }}>
        {item.taxType && <span>{TAX_NAME(item.taxType)}{item.periodKey ? ` · ${item.periodKey}` : ''}</span>}
        {item.hmrcReference && <span>Ref {item.hmrcReference}</span>}
        {item.counterparty && <span>{item.counterparty}</span>}
        {item.responseDue && (
          <span style={late ? { color: 'var(--crit)' } : undefined}>
            Respond by {fmtD(item.responseDue)}{late ? ' — overdue' : ''}
          </span>
        )}
        {item.responseStatus === 'closed' && (
          <span style={{ color: 'var(--ok)' }}>
            Closed{item.resolution ? ` — ${item.resolution}` : ''}
          </span>
        )}
        {item.responseStatus === 'sent' && isOpen(item) && (
          <span>Reply sent — open until they come back</span>
        )}
      </div>

      {item.summary && (
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed">{item.summary}</p>
      )}

      {item.files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.files.map((f) => (
            <span key={f.id} className="flex items-center gap-1 rounded-md border px-2 py-1 text-[12px]"
              style={{ borderColor: 'var(--line)', background: 'var(--panel2)' }}>
              <form action={downloadCorrespondenceFile}>
                <input type="hidden" name="file_id" value={f.id} />
                <button type="submit" className="underline" title={f.contentType ?? undefined}>
                  {f.fileName}
                </button>
              </form>
              <span style={{ color: 'var(--muted)' }}>
                {f.sizeBytes === null ? '' : `${Math.max(1, Math.round(f.sizeBytes / 1024))} KB`}
              </span>
              <form action={deleteCorrespondenceFile}>
                <input type="hidden" name="file_id" value={f.id} />
                <input type="hidden" name="slug" value={slug} />
                <button type="submit" title="Remove this document" style={{ color: 'var(--muted)' }}>&times;</button>
              </form>
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: 'var(--line2)' }}>
        <a className="btn text-[12px]" href={`?edit=${item.id}#top`}>Edit</a>

        <details>
          <summary className="btn cursor-pointer text-[12px]">Attach</summary>
          <form action={addCorrespondenceFile} encType="multipart/form-data"
            className="mt-2 w-[320px] space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--line)' }}>
            <input type="hidden" name="entity_id" value={entityId} />
            <input type="hidden" name="correspondence_id" value={item.id} />
            <input type="hidden" name="slug" value={slug} />
            <input name="files" type="file" multiple required className="input"
              accept=".pdf,.jpg,.jpeg,.png,.heic,.tif,.tiff,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx,.eml" />
            <button className="btn btn-pri w-full text-[12px]" type="submit">Upload</button>
          </form>
        </details>

        {open && item.responseStatus !== 'sent' && (
          <form action={resolveCorrespondence}>
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="status" value="sent" />
            <button className="btn text-[12px]" type="submit">Reply sent</button>
          </form>
        )}

        {open && (
          <details>
            <summary className="btn cursor-pointer text-[12px]">Close it</summary>
            <form action={resolveCorrespondence}
              className="mt-2 w-[320px] space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--line)' }}>
              <input type="hidden" name="id" value={item.id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="status" value="closed" />
              <input name="resolution" className="input" placeholder="What was done" />
              <button className="btn btn-pri w-full text-[12px]" type="submit">Mark dealt with</button>
            </form>
          </details>
        )}

        {item.responseStatus === 'closed' && (
          <form action={resolveCorrespondence}>
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="reopen" value="1" />
            <button className="btn text-[12px]" type="submit">Reopen</button>
          </form>
        )}

        <span className="flex-1" />

        <details>
          <summary className="cursor-pointer text-[12px]" style={{ color: 'var(--muted)' }}>Delete</summary>
          <form action={deleteCorrespondence}
            className="mt-2 w-[280px] space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--line)' }}>
            <input type="hidden" name="id" value={item.id} />
            <input type="hidden" name="slug" value={slug} />
            <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
              Removes the record and its {item.files.length} document{item.files.length === 1 ? '' : 's'}. There is no undo.
            </p>
            <button className="btn w-full text-[12px]" type="submit" style={{ color: 'var(--crit)' }}>
              Delete permanently
            </button>
          </form>
        </details>
      </div>
    </div>
  );
}
