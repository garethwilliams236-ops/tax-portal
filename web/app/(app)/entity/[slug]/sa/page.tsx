import { notFound } from 'next/navigation';
import { getEntityBySlug } from '@/lib/db/queries';
import { getSaBoxes } from '@/lib/db/sa';
import { saveSaBoxes } from '@/lib/actions/sa';
import { SA_PAGES, saPage } from '@/lib/sa/forms';
import { pageResult, saReturn, type SaValues } from '@/lib/sa/compute';
import { taxYears, chosenYear } from '@/lib/years';
import { money2 } from '@/lib/format';
import { EntityHeader, YearTabs } from '../nav';

export const dynamic = 'force-dynamic';

/**
 * The Self Assessment return, in three columns.
 *
 *   1 · the whole return       — every page's income in one computation
 *   2 · the boxes              — one SA page at a time, HMRC's numbers and words
 *   3 · what this page comes to — the arithmetic for the page you are typing into
 *
 * The middle column is the only one you type in. The two beside it are read
 * from the same stored figures on every render, so nothing on this screen can
 * be stale relative to anything else on it.
 */
export default async function SaPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ year?: string; page?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const asAt = new Date();

  const entity = await getEntityBySlug(slug);
  if (!entity) notFound();

  const year = chosenYear(asAt, sp.year);
  const values: SaValues = await getSaBoxes(entity.id, year);

  const current = saPage(sp.page ?? '') ?? SA_PAGES[0]!;
  const ret = saReturn(values, year);
  const page = pageResult(current.code, values);

  const href = (code: string) => `?year=${encodeURIComponent(year)}&page=${code}`;
  const hasEntries = (code: string) => !pageResult(code, values).empty;

  return (
    <>
      <EntityHeader entity={entity} active="sa" />
      <YearTabs years={taxYears(asAt)} active={year} hrefFor={(y) => `?year=${encodeURIComponent(y)}&page=${current.code}`} />

      <p className="mt-2 text-[12px]" style={{ color: 'var(--muted)' }}>
        HMRC&rsquo;s own box numbers and wording, taken from the {year.replace('-', '/')} forms.
        Everything is held against this tax year alone.
      </p>

      <div className="mt-6 grid gap-5 xl:grid-cols-[300px_minmax(0,1fr)_340px]">

        {/* ---------------------------------------------------------------- */}
        {/* 1 · the whole return                                              */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            1 · The return
          </h3>

          <div className="tw p-4">
            <Row label="Employment" value={ret.income.employment ?? 0} />
            <Row label="Self-employment" value={ret.income.selfEmployment ?? 0} />
            <Row label="Property" value={ret.income.property ?? 0} />
            <Row label="Pensions" value={ret.income.pension ?? 0} />
            <Row label="Other income" value={ret.income.other ?? 0} />
            <Row label="Savings" value={ret.income.savings ?? 0} />
            <Row label="Dividends" value={ret.income.dividends ?? 0} />

            <div className="my-2 border-t" style={{ borderColor: 'var(--line2)' }} />
            <Row label="Total income" value={ret.tax?.totalIncome ?? 0} strong />
            <Row label="Pension contributions" value={-(ret.income.grossPensionContributions ?? 0)} />
            <Row label="Gift Aid, gross" value={-(ret.income.giftAidGross ?? 0)} />
            <Row label="Adjusted net income" value={ret.tax?.adjustedNetIncome ?? 0} />
            <Row label="Personal allowance" value={ret.tax?.personalAllowance ?? 0} />
            {(ret.tax?.personalAllowanceLost ?? 0) > 0 && (
              <Row label="Allowance lost to taper" value={-(ret.tax?.personalAllowanceLost ?? 0)} tone="crit" />
            )}

            <div className="my-2 border-t" style={{ borderColor: 'var(--line2)' }} />
            <Row label="Income tax" value={ret.tax?.totalTax ?? 0} strong />
            {(ret.tax?.financeCostReducer ?? 0) > 0 && (
              <Row label="of which finance cost reducer" value={-(ret.tax?.financeCostReducer ?? 0)} />
            )}
            <Row label="Tax already paid" value={-ret.taxDeducted} />
            <div className="mt-2 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
              <Row
                label={ret.balance >= 0 ? 'Balance owed' : 'Overpaid'}
                value={Math.abs(ret.balance)}
                strong
                tone={ret.balance >= 0 ? 'crit' : 'ok'}
              />
            </div>
          </div>

          {ret.warnings.length > 0 && (
            <ul className="mt-3 space-y-2">
              {ret.warnings.map((w, i) => (
                <li key={i} className="rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed"
                  style={{ borderColor: 'var(--line)', background: 'var(--warn-bg)', color: 'var(--warn)' }}>
                  {w}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 2 · the boxes                                                     */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            2 · {current.code} &middot; {current.title}
          </h3>

          <div className="mb-3 flex flex-wrap gap-1.5">
            {SA_PAGES.map((p) => {
              const on = p.code === current.code;
              const filled = hasEntries(p.code);
              return (
                <a key={p.code} href={href(p.code)}
                  title={p.title}
                  className="rounded-md border px-2.5 py-1 text-[12px] font-medium"
                  style={{
                    borderColor: on ? 'var(--accent)' : filled ? 'var(--line)' : 'var(--line2)',
                    borderWidth: on ? 2 : 1,
                    background: on ? 'var(--accent-bg)' : filled ? 'var(--panel)' : 'var(--panel2)',
                    color: on ? 'var(--ink)' : filled ? 'var(--ink)' : 'var(--muted)',
                  }}>
                  {p.code}
                  {filled && !on && <span className="ml-1.5" style={{ color: 'var(--ok)' }}>&bull;</span>}
                </a>
              );
            })}
          </div>

          {current.note && (
            <p className="mb-3 rounded-lg border px-3 py-2 text-[12px] leading-relaxed"
              style={{ borderColor: 'var(--line)', background: 'var(--info-bg)', color: 'var(--info)' }}>
              {current.note}
            </p>
          )}

          <form action={saveSaBoxes} className="tw p-4">
            <input type="hidden" name="entity_id" value={entity.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="tax_year" value={year} />
            <input type="hidden" name="page" value={current.code} />

            {current.sections.map((section) => (
              <div key={section.name} className="mb-5 last:mb-0">
                <h4 className="mb-2 border-b pb-1 text-[12px] font-semibold" style={{ borderColor: 'var(--line2)' }}>
                  {section.name}
                </h4>

                <div className="space-y-2">
                  {section.boxes.map((box) => {
                    const v = values[box.key];
                    return (
                      <label key={box.key} className="flex items-start gap-3">
                        <span className="num w-11 shrink-0 pt-2 text-[11.5px] font-semibold" style={{ color: 'var(--muted)' }}>
                          {box.box}
                        </span>
                        <span className="flex-1 pt-1.5 text-[12px] leading-snug">
                          {box.label}
                          {box.unverified && (
                            <span className="pill pill-warn ml-1.5" title="Research could not fully confirm this box's section or wording against the published form.">
                              check
                            </span>
                          )}
                        </span>
                        <span className="w-[150px] shrink-0">
                          {box.kind === 'yesno' ? (
                            <input type="checkbox" name={box.key} defaultChecked={v === true}
                              className="mt-2 h-4 w-4" />
                          ) : (
                            <input
                              name={box.key}
                              defaultValue={v === undefined || v === null || v === false ? '' : String(v)}
                              type={box.kind === 'date' ? 'date' : 'text'}
                              inputMode={box.kind === 'money' || box.kind === 'number' ? 'decimal' : undefined}
                              className={`input ${box.kind === 'money' || box.kind === 'number' ? 'num' : ''}`}
                              placeholder={box.kind === 'money' ? '£' : ''}
                            />
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="mt-4 flex items-center gap-3 border-t pt-4" style={{ borderColor: 'var(--line)' }}>
              <button className="btn btn-pri" type="submit">Save {current.code}</button>
              <span className="text-[11.5px]" style={{ color: 'var(--muted)' }}>
                Saves this page only. A box left blank is stored as nothing entered, not as nil.
              </span>
            </div>
          </form>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* 3 · what this page comes to                                       */}
        {/* ---------------------------------------------------------------- */}
        <section>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            3 · {current.code} comes to
          </h3>

          <div className="tw p-4">
            {page.empty ? (
              <p className="py-4 text-center text-[12.5px]" style={{ color: 'var(--muted)' }}>
                Nothing entered on this page.
              </p>
            ) : page.lines.length === 0 ? (
              <p className="py-4 text-center text-[12.5px]" style={{ color: 'var(--muted)' }}>
                This page carries no figures of its own.
              </p>
            ) : (
              page.lines.map((l, i) => (
                <div key={i} className="border-b py-1.5 last:border-0" style={{ borderColor: 'var(--line2)' }}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px]">{l.label}</span>
                    <span className="num text-[12.5px] font-medium">{money2(l.value)}</span>
                  </div>
                  {(l.from || l.note) && (
                    <div className="mt-0.5 text-[11px] leading-snug" style={{ color: 'var(--muted)' }}>
                      {l.from}{l.from && l.note ? ' — ' : ''}{l.note}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <p className="mt-3 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed"
            style={{ borderColor: 'var(--line)', background: 'var(--panel2)', color: 'var(--muted)' }}>
            {page.feeds}
          </p>

          {page.warnings.map((w, i) => (
            <p key={i} className="mt-2 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed"
              style={{ borderColor: 'var(--line)', background: 'var(--warn-bg)', color: 'var(--warn)' }}>
              {w}
            </p>
          ))}
        </section>
      </div>
    </>
  );
}

function Row({
  label, value, strong, tone,
}: {
  label: string; value: number; strong?: boolean; tone?: 'ok' | 'crit';
}) {
  if (value === 0 && !strong) return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px]">
      <span className={`text-[12.5px] ${strong ? 'font-semibold' : ''}`}>{label}</span>
      <span
        className={`num text-[12.5px] ${strong ? 'font-semibold' : ''}`}
        style={tone ? { color: `var(--${tone})` } : undefined}
      >
        {money2(value)}
      </span>
    </div>
  );
}
