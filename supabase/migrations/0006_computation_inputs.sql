-- Ardent Tax Portal — computation inputs
-- Migration 0006.
--
-- The figures you type into a computation screen belong to ONE period. The
-- prototype learned this the hard way: payroll and property figures lived on
-- the durable record — the person, the property — with no period on them, so
-- entering £6,000 of annual pay for FY25 showed £6,000 in every other year too.
--
-- The unique key here is (entity, tax, period). There is no row that is not
-- pinned to a period, so the leak is not a bug that can recur; it is a shape
-- the table cannot hold.
--
-- The inputs are stored. The RESULT is not: it is recomputed from these
-- figures and the rate tables on every render, so a corrected rate or a fixed
-- engine bug reaches every historic screen at once. The only computed number
-- that is ever persisted is the one you deliberately file, which becomes
-- tax_returns.declared_amount — and that is a declaration, not a calculation.

create table computation_inputs (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  tax_type text not null check (tax_type in ('CT','VAT','PAYE','SA','CGT')),

  -- Same key as tax_returns: tax-year string for SA, period end date otherwise.
  period_key text not null,

  -- Free-form by design. The field set for a tax changes as the rules change,
  -- and a column per box would mean a migration every Budget. What each key
  -- means is defined in lib/compute.ts, next to the code that reads it.
  inputs jsonb not null default '{}'::jsonb,

  updated_at timestamptz not null default now(),
  unique (entity_id, tax_type, period_key)
);
create index computation_inputs_entity_idx on computation_inputs (entity_id, tax_type);

alter table computation_inputs enable row level security;

create policy computation_inputs_read on computation_inputs
  for select using (can_read_entity(entity_id));
create policy computation_inputs_write on computation_inputs
  for all using (can_write_entity(entity_id))
  with check (can_write_entity(entity_id));
