import { notFound } from 'next/navigation';
import {
  getEntityBySlug, getLiabilities, getPayments, getReturns, taxLinesFor, allocatedTo, outstandingOf,
} from '@/lib/db/queries';
import { slotsFor, joinReturns } from '@/lib/db/slots';
import { fileReturn, recordPayment } from '@/lib/actions/ledger';
import { getComputationInputs, inputKey } from '@/lib/db/computations';
import { getProperties, propertyPosition } from '@/lib/db/properties';
import { getCorrespondence, itemsFor, isOverdue } from '@/lib/db/correspondence';
import { getDocuments, docsFor, humanSize } from '@/lib/db/documents';
import { Computation } from './computation';
import { EntityHeader } from './nav';
import type { Detail } from '@/lib/compute';
import { money, money2, fmtD, daysTo, TAX_LABEL } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function EntityPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tax?: string; period?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const asAt = new Date();

  const entity = await getEntityBySlug(slug);
  if (!entity) notFound();

  const [returns, liabilities, payments, allInputs, correspondence] = await Promise.all([
    getReturns(entity.id), getLiabilities(entity.id), getPayments(entity.id),
    getComputationInputs(entity.id), getCorrespondence(entity.id),
  ]);
  const documents = await getDocuments(entity.id);

  const lines = taxLinesFor(entity, returns, liabilities, payments, asAt);
  const activeTax = lines.find((l) => l.taxType === sp.tax)?.taxType ?? lines[0]?.taxType;

  const slots = joinReturns(slotsFor(entity, asAt), returns).filter((s) => s.taxType === activeTax);
  const liabs = liabilities.filter((l) => l.taxType === activeTax);
  const pays = payments.filter((p) => p.taxType === activeTax);

  // Which period the computation screen is looking at. Default to the earliest
  // one still unfiled — the thing actually wanting attention — and fall back to
  // the most recent when everything is filed.
  const periods = slots.slice(-14);
  const activePeriod =
    periods.find((s) => s.periodKey === sp.period)
    ?? periods.find((s) => s.status !== 'filed' && s.fileBy >= asAt)
    ?? periods[periods.length - 1];

  const forPeriod = activePeriod
    ? itemsFor(correspondence, activePeriod.taxType, activePeriod.periodKey) : [];
  const docsForPeriod = activePeriod
    ? docsFor(documents, activePeriod.taxType, activePeriod.periodKey) : [];

  // Detail the portal already holds for that period, standing in for a typed
  // total. For Self Assessment the period key IS the tax year.
  let detail: Detail = {};
  if (entity.type === 'individual' && activePeriod?.taxType === 'SA') {
    const properties = await getProperties(entity.id);
    const pos = propertyPosition(properties, activePeriod.periodKey);
    if (pos.anyFigures) {
      detail = {
        propertyProfit: pos.profit,
        propertyFinanceCosts: pos.financeCosts,
        propertyCount: properties.filter((p) => p.figures.has(activePeriod.periodKey)).length,
      };
    }
  }

  return (
    <>
      <EntityHeader entity={entity} active="taxes" />

      {lines.length === 0 ? (
        <p className="mt-6 text-sm" style={{ color: 'var(--muted)' }}>
          Dormant — no Corporation Tax, VAT or PAYE obligations. Companies House filings still apply:
          a confirmation statement each year within 14 days of the review period, and dormant accounts
          at 9 months.
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-1.5">
            {lines.map((l) => (
              <a key={l.taxType} href={`?tax=${l.taxType}`}
                className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${l.taxType === activeTax ? 'btn-pri' : ''}`}
                style={{ borderColor: 'var(--line)', background: l.taxType === activeTax ? 'var(--accent)' : 'var(--panel)', color: l.taxType === activeTax ? 'var(--accent-ink)' : 'var(--muted)' }}>
                {TAX_LABEL[l.taxType]}
              </a>
            ))}
          </div>

          <Section n="1" title="Computation"
            note="Figures are held per period. Nothing computed here is owed until it is filed as a return." />

          {periods.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--muted)' }}>No periods in the calendar for this tax.</p>
          ) : (
            <>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                {periods.map((s) => {
                  const late = s.status !== 'filed' && s.fileBy < asAt;
                  const on = s.periodKey === activePeriod?.periodKey;
                  return (
                    <a key={s.periodKey}
                      href={`?tax=${activeTax}&period=${encodeURIComponent(s.periodKey)}`}
                      title={`${s.label} — file by ${fmtD(s.fileBy)}`}
                      className="whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[12px] font-medium"
                      style={{
                        borderColor: on ? 'var(--accent)' : 'var(--line)',
                        borderWidth: on ? 2 : 1,
                        background: s.status === 'filed' ? 'var(--ok-bg)' : late ? 'var(--crit-bg)' : 'var(--panel)',
                        color: s.status === 'filed' ? 'var(--ok)' : late ? 'var(--crit)' : 'var(--muted)',
                      }}>
                      {s.short}
                    </a>
                  );
                })}
              </div>
              <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--muted)' }}>
                Green is filed, red is open and past its filing date, plain is open and not yet due.
              </p>

              {activePeriod && (
                <Computation
                  entity={entity}
                  slot={activePeriod}
                  inputs={allInputs.get(inputKey(activePeriod.taxType, activePeriod.periodKey)) ?? {}}
                  slug={slug}
                  detail={detail}
                />
              )}

              {/* Letters filed against THIS period, on the screen for it — a
                  record you have to go and look for is a record you forget. */}
              {activePeriod && forPeriod.length > 0 && (
                <div className="tw mt-4 p-4">
                  <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                    Correspondence on this period
                  </div>
                  {forPeriod.map((c) => (
                    <a key={c.id} href={`/entity/${slug}/correspondence#c-${c.id}`}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b py-1.5 text-[12.5px] last:border-0"
                      style={{ borderColor: 'var(--line2)' }}>
                      <span style={{ color: 'var(--muted)' }}>{fmtD(c.occurredOn)}</span>
                      <span className="font-medium">{c.subject}</span>
                      {c.files.length > 0 && (
                        <span style={{ color: 'var(--muted)' }}>
                          {c.files.length} document{c.files.length === 1 ? '' : 's'}
                        </span>
                      )}
                      {isOverdue(c, asAt) && <span className="pill pill-crit">overdue</span>}
                      {c.responseStatus === 'closed' && <span className="pill pill-ok">closed</span>}
                    </a>
                  ))}
                </div>
              )}

              {activePeriod && docsForPeriod.length > 0 && (
                <div className="tw mt-4 p-4">
                  <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                    Documents on this period
                  </div>
                  {docsForPeriod.map((d) => (
                    <a key={d.id} href={`/entity/${slug}/documents?period=${encodeURIComponent(d.periodLabel ?? '')}`}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b py-1.5 text-[12.5px] last:border-0"
                      style={{ borderColor: 'var(--line2)' }}>
                      <span className="font-medium">{d.fileName}</span>
                      <span style={{ color: 'var(--muted)' }}>{humanSize(d.sizeBytes)}</span>
                    </a>
                  ))}
                </div>
              )}
            </>
          )}

          <Section n="2" title="Returns"
            note="The return declares the liability. Nothing is charged until one is filed with a figure." />
          <div className="tw">
            <table className="w-full text-[13px]">
              <thead>
                <Head cols={['Period', 'File by', 'Status', 'Declared', 'Filed', '']} />
              </thead>
              <tbody>
                {slots.slice(-14).map((s) => {
                  const late = s.status !== 'filed' && s.fileBy < asAt;
                  return (
                    <tr key={s.periodKey} className="border-t align-top" style={{ borderColor: 'var(--line2)', background: late ? 'var(--crit-bg)' : undefined }}>
                      <td className="px-4 py-2 font-medium">{s.short}</td>
                      <td className="px-4 py-2">{fmtD(s.fileBy)}</td>
                      <td className="px-4 py-2">
                        {s.status === 'filed'
                          ? <span className="pill pill-ok">Filed</span>
                          : late
                            ? <span className="pill pill-crit">{Math.abs(daysTo(s.fileBy, asAt))}d late</span>
                            : <span className="pill pill-mute">Not started</span>}
                      </td>
                      <td className="num px-4 py-2">
                        {s.declaredAmount !== null ? money2(s.declaredAmount)
                          : s.amountMissing ? <span className="text-[12px]" style={{ color: 'var(--crit)' }}>not recorded</span>
                          : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td className="px-4 py-2">{s.filedOn ? fmtD(s.filedOn) : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td className="px-4 py-2">
                        <details>
                          <summary className="btn cursor-pointer text-[12px]">{s.status === 'filed' ? 'Edit' : 'File'}</summary>
                          <form action={fileReturn} className="mt-2 w-[280px] space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--line)' }}>
                            <input type="hidden" name="entity_id" value={entity.id} />
                            <input type="hidden" name="tax_type" value={s.taxType} />
                            <input type="hidden" name="period_key" value={s.periodKey} />
                            <input type="hidden" name="period_start" value={s.periodStart ? s.periodStart.toISOString().slice(0, 10) : ''} />
                            <input type="hidden" name="period_end" value={s.periodEnd.toISOString().slice(0, 10)} />
                            <input type="hidden" name="file_by" value={s.fileBy.toISOString().slice(0, 10)} />
                            <input type="hidden" name="pay_by" value={s.payBy.toISOString().slice(0, 10)} />
                            <label className="block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Status</label>
                            <select name="status" defaultValue={s.status} className="input">
                              <option value="not_started">Not started</option>
                              <option value="in_progress">In progress</option>
                              <option value="ready_to_file">Ready to file</option>
                              <option value="filed">Filed</option>
                            </select>
                            <label className="block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Declared</label>
                            <input name="declared_amount" type="number" step="0.01" defaultValue={s.declaredAmount ?? ''} className="input" placeholder="0.00" />
                            <label className="block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Filed on</label>
                            <input name="filed_on" type="date" defaultValue={s.filedOn ? s.filedOn.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)} className="input" />
                            <input name="submission_reference" className="input" placeholder="HMRC reference" />
                            <p className="text-[11px]" style={{ color: 'var(--muted)' }}>Money falls due {fmtD(s.payBy)}.</p>
                            <button className="btn btn-pri w-full">Save</button>
                          </form>
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Section n="3" title="Liabilities"
            note="Charged by a filed return, or by statute in advance of one. Outstanding is arithmetic, never a status." />
          <div className="tw">
            <table className="w-full text-[13px]">
              <thead><Head cols={['Due', 'Charge', 'Amount', 'Paid', 'Outstanding']} /></thead>
              <tbody>
                {liabs.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center" style={{ color: 'var(--muted)' }}>
                    Nothing charged. File a return to declare a liability.
                  </td></tr>
                ) : liabs.map((l) => {
                  const paid = allocatedTo(l.id, pays);
                  const out = outstandingOf(l, pays);
                  const late = out > 0.005 && l.dueDate < asAt;
                  return (
                    <tr key={l.id} className="border-t" style={{ borderColor: 'var(--line2)', background: late ? 'var(--crit-bg)' : undefined }}>
                      <td className="whitespace-nowrap px-4 py-2">{fmtD(l.dueDate)}</td>
                      <td className="px-4 py-2">
                        {l.label}
                        {l.detail && <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>{l.detail}</span>}
                        {l.isEstimated && <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>estimated — reconciles when the return is filed</span>}
                      </td>
                      <td className="num px-4 py-2">{money2(l.amount)}</td>
                      <td className="num px-4 py-2">{money2(paid)}</td>
                      <td className="num px-4 py-2 font-semibold" style={{ color: late ? 'var(--crit)' : undefined }}>{money2(out)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <Section n="4" title="Payments"
            note="Each payment is allocated to a named liability. Anything unallocated sits as money on account — real, but not settling a debt." />
          <div className="tw">
            <table className="w-full text-[13px]">
              <thead><Head cols={['Paid', 'Amount', 'Allocated', 'Unallocated', 'Reference']} /></thead>
              <tbody>
                {pays.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center" style={{ color: 'var(--muted)' }}>No payments recorded.</td></tr>
                ) : pays.map((p) => {
                  const alloc = p.allocations.reduce((a, b) => a + b.amount, 0);
                  const un = Math.round((p.amount - alloc) * 100) / 100;
                  return (
                    <tr key={p.id} className="border-t" style={{ borderColor: 'var(--line2)' }}>
                      <td className="whitespace-nowrap px-4 py-2">
                        {fmtD(p.paidOn)}
                        {p.direction === 'from_hmrc' && <span className="block text-[11.5px]" style={{ color: 'var(--muted)' }}>repayment received</span>}
                      </td>
                      <td className="num px-4 py-2">{money2(p.amount)}</td>
                      <td className="num px-4 py-2">{money2(alloc)}</td>
                      <td className="num px-4 py-2" style={{ color: un > 0.005 ? 'var(--warn)' : undefined }}>{un > 0.005 ? money2(un) : '—'}</td>
                      <td className="px-4 py-2 text-[12px]" style={{ color: 'var(--muted)' }}>{p.reference ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <form action={recordPayment} className="card mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="entity_id" value={entity.id} />
            <input type="hidden" name="tax_type" value={activeTax} />
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Amount</label>
              <input name="amount" type="number" step="0.01" required className="input w-36" placeholder="0.00" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Date paid</label>
              <input name="paid_on" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className="input w-44" />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Direction</label>
              <select name="direction" className="input w-52">
                <option value="to_hmrc">Paid to HMRC</option>
                <option value="from_hmrc">Repayment received</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-[11px] font-semibold uppercase" style={{ color: 'var(--muted)' }}>Reference</label>
              <input name="reference" className="input" />
            </div>
            <label className="flex items-center gap-2 pb-2 text-[12.5px]">
              <input name="auto_allocate" type="checkbox" defaultChecked className="h-4 w-4" />
              Allocate oldest first
            </label>
            <button className="btn btn-pri">Record</button>
          </form>
        </>
      )}
    </>
  );
}

function Section({ n, title, note }: { n: string; title: string; note: string }) {
  return (
    <div className="mb-2 mt-8">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>{n} · {title}</h3>
      <p className="mt-0.5 text-[12px]" style={{ color: 'var(--muted)' }}>{note}</p>
    </div>
  );
}

function Head({ cols }: { cols: string[] }) {
  return (
    <tr className="text-left text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--muted)', background: 'var(--panel2)' }}>
      {cols.map((c, i) => (
        <th key={i} className={`px-4 py-2 font-semibold ${['Amount','Paid','Outstanding','Declared','Allocated','Unallocated'].includes(c) ? 'text-right' : ''}`}>{c}</th>
      ))}
    </tr>
  );
}
