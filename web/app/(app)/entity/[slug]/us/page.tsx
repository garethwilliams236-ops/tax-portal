import { notFound } from 'next/navigation';
import { getEntityBySlug } from '@/lib/db/queries';
import { getUsYears } from '@/lib/db/us';
import { saveUsYear } from '@/lib/actions/us';
import { GROUPS, STATUSES, prepare, type UsStored } from '@/lib/us/inputs';
import { computeUs, NOT_APPLIED } from '@/lib/tax/us/form1040';
import { FILING_STATUS_LABEL, US_YEARS_HELD, usRates } from '@/lib/tax/us/rates';
import { usDeadlines } from '@/lib/tax/us/deadlines';
import { fmtD, usd } from '@/lib/format';
import { EntityHeader } from '../nav';

export const dynamic = 'force-dynamic';

/**
 * The US federal return, one calendar year at a time.
 *
 * Left: what was typed, in the year's currency. Right: the 1040 it produces,
 * in dollars, with the form line beside every figure, then the deadlines.
 * Nothing computed is stored; the right column is worked out on every render
 * from the left column and the rate table.
 */
export default async function UsPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const entity = await getEntityBySlug(slug);
  if (!entity || entity.type !== 'individual') notFound();

  const asAt = new Date();
  const lastYear = asAt.getUTCFullYear() - 1;
  const requested = Number(sp.year);
  const year = US_YEARS_HELD.includes(requested) ? requested
    : US_YEARS_HELD.includes(lastYear) ? lastYear : US_YEARS_HELD[US_YEARS_HELD.length - 1]!;

  const years = await getUsYears(entity.id);
  const s: UsStored = years.get(year) ?? {};
  const a = s.amounts ?? {};
  const currency = s.currency ?? 'GBP';
  const prepared = prepare(year, s);
  const result = prepared.ok ? computeUs(prepared.inputs) : null;
  const rates = usRates(year);
  const due = usDeadlines(year, { abroad: s.abroad ?? true, extensionFiled: s.extension_filed ?? false });

  return (
    <>
      <EntityHeader entity={entity} active="us" />

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {US_YEARS_HELD.map((y) => (
          <a key={y} href={`?year=${y}`}
            className="rounded-md border px-3 py-1.5 text-[13px] font-medium"
            style={{
              borderColor: y === year ? 'var(--accent)' : 'var(--line)',
              borderWidth: y === year ? 2 : 1,
              background: y === year ? 'var(--accent-bg)' : 'var(--panel)',
              color: y === year ? 'var(--ink)' : 'var(--muted)',
            }}>
            {y}
          </a>
        ))}
        <span className="ml-2 text-[12px]" style={{ color: 'var(--muted)' }}>
          Calendar years. Rates held for {US_YEARS_HELD.join(' and ')} ({rates.source}).
        </span>
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ------------------------------------------------------------ inputs */}
        <form action={saveUsYear} className="card space-y-5">
          <input type="hidden" name="entity_id" value={entity.id} />
          <input type="hidden" name="slug" value={entity.slug} />
          <input type="hidden" name="year" value={year} />

          <div className="grid grid-cols-2 gap-3">
            <Field label="Filing status">
              <select name="status" defaultValue={s.status ?? ''} className="input">
                <option value="">Choose…</option>
                {STATUSES.map((k) => <option key={k} value={k}>{FILING_STATUS_LABEL[k]}</option>)}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Kept in">
                <select name="currency" defaultValue={currency} className="input">
                  <option value="GBP">Pounds</option>
                  <option value="USD">Dollars</option>
                </select>
              </Field>
              <Field label="$ per £1">
                <input name="usd_per_gbp" className="input" inputMode="decimal"
                  defaultValue={s.usd_per_gbp ?? ''} placeholder="e.g. 1.2800" />
              </Field>
            </div>
          </div>
          <p className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
            A US citizen married to someone who is not a US person usually files married filing
            separately, or head of household with a qualifying child (s.2(b)(2)(B)). Joint filing
            needs a s.6013(g) election, which brings the other spouse&rsquo;s worldwide income into
            the US return. Ask Ivor about filing status for the authority on each.
          </p>

          {GROUPS.map((g) => (
            <fieldset key={g.title}>
              <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                {g.title}
              </legend>
              <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
                {g.fields.map((f) => (
                  <label key={f.key} className="block text-[12.5px]">
                    <span>{f.label} <span style={{ color: 'var(--muted)' }}>({f.usd ? '$' : currency === 'USD' ? '$' : '£'})</span></span>
                    <input name={f.key} className="input mt-0.5" inputMode="decimal"
                      defaultValue={a[f.key] ?? ''} />
                    {f.hint && <span className="mt-0.5 block text-[11px]" style={{ color: 'var(--muted)' }}>{f.hint}</span>}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          <fieldset>
            <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Children
            </legend>
            <label className="block max-w-[260px] text-[12.5px]">
              Children under 17 on 31 December {year}, each with a US Social Security number
              <input name="qualifying_children" className="input mt-0.5" inputMode="numeric" defaultValue={s.qualifying_children ?? ''} />
            </label>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
              Up to {usd(rates.childTaxCredit)} a child off US tax, and up to {usd(rates.childTaxCreditRefundable)} a
              child paid back in cash — but the cash part is lost if the exclusion below is claimed.
            </p>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Foreign earned income exclusion
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="feie_claimed" className="h-4 w-4" defaultChecked={s.feie_claimed ?? false} />
                Claim on Form 2555
              </label>
              <label className="block text-[12.5px]">
                Qualifying days in {year}
                <input name="qualifying_days" className="input mt-0.5" inputMode="numeric" defaultValue={s.qualifying_days ?? ''} />
              </label>
            </div>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--muted)' }}>
              Limit {usd(rates.feie)} for a full year. Revoking the election bars it for five years
              (s.911(e)(2)), so compare against the credit-only position before choosing.
            </p>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Filing
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="abroad" className="h-4 w-4" defaultChecked={s.abroad ?? true} />
                Living abroad on 15 April
              </label>
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" name="extension_filed" className="h-4 w-4" defaultChecked={s.extension_filed ?? false} />
                Form 4868 filed
              </label>
              <label className="block text-[12.5px]">
                1040 filed on
                <input type="date" name="filed_on" className="input mt-0.5" defaultValue={s.filed_on ?? ''} />
              </label>
              <label className="block text-[12.5px]">
                FBAR filed on
                <input type="date" name="fbar_filed_on" className="input mt-0.5" defaultValue={s.fbar_filed_on ?? ''} />
              </label>
            </div>
          </fieldset>

          <div className="flex justify-end border-t pt-4" style={{ borderColor: 'var(--line)' }}>
            <button className="btn btn-pri">Save {year}</button>
          </div>
        </form>

        {/* ----------------------------------------------------------- result */}
        <div className="space-y-4">
          {!result ? (
            <div className="card text-[13px]" style={{ color: 'var(--muted)' }}>
              {prepared.ok ? null : prepared.reason}
            </div>
          ) : (
            <>
              <div className="tw">
                <div className="flex items-baseline gap-2 border-b px-4 py-2.5" style={{ borderColor: 'var(--line)' }}>
                  <span className="text-[13px] font-semibold">Form 1040 — {year}</span>
                  <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
                    {FILING_STATUS_LABEL[result.status]}
                    {prepared.ok && prepared.currency === 'GBP' && ` · converted at $${prepared.rate} per £1`}
                  </span>
                </div>
                <table className="w-full text-[13px]">
                  <tbody>
                    {result.lines.map((l, n) => (
                      <tr key={n} className="border-t align-top" style={{ borderColor: 'var(--line2)', fontWeight: l.total ? 600 : 400 }}>
                        <td className="px-4 py-1.5">
                          {l.label}
                          {l.plain && <span className="block text-[11.5px] font-normal">{l.plain}</span>}
                          {l.note && <span className="block text-[11px] font-normal" style={{ color: 'var(--muted)' }}>{l.note}</span>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-[11px] font-normal" style={{ color: 'var(--muted)' }}>{l.ref}</td>
                        <td className="whitespace-nowrap px-4 py-1.5 text-right tabular-nums">{usd(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {result.warnings.length > 0 && (
                <div className="card text-[12.5px]" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}>
                  {result.warnings.map((w) => <p key={w} className="mt-1 first:mt-0">{w}</p>)}
                </div>
              )}

              <div className="card text-[13px]">
                <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                  Forms this year needs
                </div>
                <ul className="space-y-1">
                  <li>Form 1040</li>
                  {result.exclusion > 0 && <li>Form 2555 — foreign earned income exclusion</li>}
                  {result.baskets.some((b) => b.credit > 0) && <li>Form 1116 — one per basket with a credit</li>}
                  {result.niit > 0 && <li>Form 8960 — net investment income tax</li>}
                  {result.form8938Required && <li>Form 8938 — specified foreign financial assets, with the 1040</li>}
                  <li style={{ color: result.fbarRequired ? 'var(--ink)' : 'var(--muted)' }}>
                    FinCEN 114 (FBAR) — {result.fbarRequired ? 'required: filed separately with FinCEN, not with the 1040' : 'not required on the balances entered'}
                  </li>
                </ul>
              </div>
            </>
          )}

          <div className="card text-[13px]">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Deadlines for {year}
            </div>
            <Due label="Pay any US tax" date={due.payment} done={false}
              note="Interest runs from this date whatever the filing extension" />
            <Due label="File Form 1040" date={due.filing} done={!!s.filed_on}
              note={due.filingBasis === 'form_4868' ? 'Extended by Form 4868'
                : due.filingBasis === 'abroad' ? 'Automatic two-month extension for a citizen abroad — attach the statement'
                : 'Regular due date'} />
            <Due label="File the FBAR" date={due.fbar} done={!!s.fbar_filed_on}
              note="Due 15 April, extended automatically to this date" />
          </div>

          <div className="card text-[12px]" style={{ color: 'var(--muted)' }}>
            <div className="mb-1 font-semibold uppercase tracking-wide">Not applied by this screen</div>
            <ul className="list-disc space-y-0.5 pl-4">
              {NOT_APPLIED.map((n) => <li key={n}>{n}</li>)}
            </ul>
            <p className="mt-2">
              Where any of these applies, the figure above is incomplete and should be checked by hand.
              Dollar figures stay on this screen and never enter the sterling ledger on the Taxes tab.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}

function Due({ label, date, done, note }: { label: string; date: Date; done: boolean; note: string }) {
  return (
    <div className="flex items-baseline gap-3 border-t py-1.5 first-of-type:border-0" style={{ borderColor: 'var(--line2)' }}>
      <span className="w-[110px] shrink-0 tabular-nums">{fmtD(date)}</span>
      <span className="flex-1">
        {label}
        <span className="block text-[11px]" style={{ color: 'var(--muted)' }}>{note}</span>
      </span>
      {done && <span className="pill pill-ok">filed</span>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}
