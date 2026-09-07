import type { EntityRow } from '@/lib/db/queries';

/**
 * The entity header and its sections.
 *
 * A company keeps a payroll; an individual holds property. Both sections are
 * shown only where they can mean something, rather than as empty tabs.
 */
export function EntityHeader({
  entity, active,
}: {
  entity: EntityRow;
  active: 'taxes' | 'payroll' | 'properties' | 'details';
}) {
  const sections: { key: typeof active; label: string; href: string }[] = [
    { key: 'taxes', label: 'Taxes', href: `/entity/${entity.slug}` },
  ];
  if (entity.type === 'company' && entity.trading_status !== 'dormant') {
    sections.push({ key: 'payroll', label: 'Payroll', href: `/entity/${entity.slug}/payroll` });
  }
  if (entity.type === 'individual') {
    sections.push({ key: 'properties', label: 'Properties', href: `/entity/${entity.slug}/properties` });
  }
  sections.push({ key: 'details', label: 'Details', href: `/entity/${entity.slug}/edit` });

  return (
    <>
      <div className="flex flex-wrap items-start gap-3 border-b pb-4" style={{ borderColor: 'var(--line)' }}>
        <div>
          <h2 className="text-[21px] font-semibold tracking-tight">{entity.name}</h2>
          <div className="mt-1 flex flex-wrap gap-3.5 text-[13px]" style={{ color: 'var(--muted)' }}>
            {entity.company_number && <span>Co. no. {entity.company_number}</span>}
            {entity.utr && <span>UTR {entity.utr}</span>}
            {entity.type === 'company' && (
              <span>
                Year end {entity.year_end_day}{' '}
                {new Date(Date.UTC(2000, (entity.year_end_month ?? 3) - 1, 1)).toLocaleString('en-GB', { month: 'long' })}
              </span>
            )}
            {entity.type === 'company' && (
              <span>{entity.vat_registered ? `VAT ${entity.vrn ?? 'registered'}` : 'Not VAT registered'}</span>
            )}
          </div>
        </div>
        <span className="flex-1" />
        <span className={`pill ${entity.type === 'individual' ? 'pill-info' : entity.trading_status === 'trading' ? 'pill-ok' : 'pill-mute'}`}>
          {entity.type === 'individual' ? 'Individual' : entity.trading_status}
        </span>
      </div>

      {sections.length > 1 && (
        <div className="mt-4 flex gap-4 border-b text-[13px]" style={{ borderColor: 'var(--line)' }}>
          {sections.map((s) => (
            <a key={s.key} href={s.href}
              className="-mb-px border-b-2 pb-2 font-medium"
              style={{
                borderColor: s.key === active ? 'var(--accent)' : 'transparent',
                color: s.key === active ? 'var(--ink)' : 'var(--muted)',
              }}>
              {s.label}
            </a>
          ))}
        </div>
      )}
    </>
  );
}

/** The tax-year strip both detail screens use. */
export function YearTabs({
  years, active, hrefFor,
}: {
  years: string[];
  active: string;
  hrefFor: (y: string) => string;
}) {
  return (
    <div className="mt-5 flex flex-wrap gap-1.5">
      {years.map((y) => (
        <a key={y} href={hrefFor(y)}
          className="rounded-md border px-3 py-1.5 text-[13px] font-medium"
          style={{
            borderColor: y === active ? 'var(--accent)' : 'var(--line)',
            borderWidth: y === active ? 2 : 1,
            background: y === active ? 'var(--accent-bg)' : 'var(--panel)',
            color: y === active ? 'var(--ink)' : 'var(--muted)',
          }}>
          {y.replace('-', '/')}
        </a>
      ))}
    </div>
  );
}
