-- Ardent Tax Portal — payroll and properties
-- Migration 0007.
--
-- Two things the portal has to hold that have a durable half and a yearly half:
--
--   a person   is durable;  what they were PAID is a fact about a tax year
--   a property is durable;  what it EARNED is a fact about a tax year
--
-- The prototype put both halves on the durable record, so entering £6,000 of
-- annual pay for one year showed £6,000 in every year. The split below is the
-- fix, and it is structural: there is no column on `payroll_people` or on
-- `properties` that can hold a figure, so the mistake cannot be made again.
--
-- Pay is keyed on the TAX YEAR (6 April to 5 April), not the accounting period.
-- NIC thresholds, the Employment Allowance and the directors' annual basis all
-- run on the tax year, and a company with a 31 December year end would
-- otherwise straddle two sets of thresholds.

-- ---------------------------------------------------------------------------
-- 1. People
-- ---------------------------------------------------------------------------

create table payroll_people (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  name text not null,
  is_director boolean not null default false,

  -- Where a directorship began mid-year the secondary threshold is pro-rated
  -- for the Employment Allowance head count, so the date matters.
  directorship_started_on date,

  started_on date,
  left_on date,

  -- The individual this person IS, where the portal also holds them as an
  -- entity — Gareth as a director of his own company. Lets a salary appear in
  -- the company's payroll and in his Self Assessment without being typed twice.
  individual_entity_id uuid references entities(id) on delete set null,

  notes text,
  created_at timestamptz not null default now(),
  unique (entity_id, name)
);
create index payroll_people_entity_idx on payroll_people (entity_id);

create table payroll_pay (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references payroll_people(id) on delete cascade,
  tax_year text not null,

  annual_pay numeric(14,2) not null default 0,
  benefits_in_kind numeric(14,2) not null default 0,

  notes text,
  updated_at timestamptz not null default now(),
  unique (person_id, tax_year)
);
create index payroll_pay_year_idx on payroll_pay (tax_year);

-- ---------------------------------------------------------------------------
-- 2. Properties
-- ---------------------------------------------------------------------------

create table properties (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  name text not null,
  address text,

  -- ITA 2007 s.836: property held jointly by spouses is taxed 50/50 whatever
  -- the beneficial shares, UNLESS a Form 17 declaration displaces it — and
  -- that declaration must reach HMRC within 60 days of its date, unextendably.
  ownership_pct numeric(7,4) not null default 100,
  jointly_held boolean not null default false,
  form17_in_force boolean not null default false,
  form17_dated date,

  is_furnished_holiday_let boolean not null default false,
  acquired_on date,
  notes text,
  created_at timestamptz not null default now(),
  unique (entity_id, name)
);
create index properties_entity_idx on properties (entity_id);

create table property_figures (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references properties(id) on delete cascade,
  tax_year text not null,

  rent_received numeric(14,2) not null default 0,
  allowable_expenses numeric(14,2) not null default 0,

  -- Residential finance costs are NOT deducted. They are relieved as a basic
  -- rate reducer under s.24, which is why they are held apart from expenses.
  finance_costs numeric(14,2) not null default 0,

  notes text,
  updated_at timestamptz not null default now(),
  unique (property_id, tax_year)
);
create index property_figures_year_idx on property_figures (tax_year);

-- ---------------------------------------------------------------------------
-- 3. Row level security
-- ---------------------------------------------------------------------------
-- The two figure tables have no entity_id of their own: rights follow the
-- parent, which is the only record that can say whose they are.

alter table payroll_people enable row level security;
alter table payroll_pay enable row level security;
alter table properties enable row level security;
alter table property_figures enable row level security;

create policy payroll_people_read on payroll_people
  for select using (can_read_entity(entity_id));
create policy payroll_people_write on payroll_people
  for all using (can_write_entity(entity_id))
  with check (can_write_entity(entity_id));

create policy payroll_pay_read on payroll_pay
  for select using (exists (
    select 1 from payroll_people p where p.id = person_id and can_read_entity(p.entity_id)));
create policy payroll_pay_write on payroll_pay
  for all using (exists (
    select 1 from payroll_people p where p.id = person_id and can_write_entity(p.entity_id)))
  with check (exists (
    select 1 from payroll_people p where p.id = person_id and can_write_entity(p.entity_id)));

create policy properties_read on properties
  for select using (can_read_entity(entity_id));
create policy properties_write on properties
  for all using (can_write_entity(entity_id))
  with check (can_write_entity(entity_id));

create policy property_figures_read on property_figures
  for select using (exists (
    select 1 from properties p where p.id = property_id and can_read_entity(p.entity_id)));
create policy property_figures_write on property_figures
  for all using (exists (
    select 1 from properties p where p.id = property_id and can_write_entity(p.entity_id)))
  with check (exists (
    select 1 from properties p where p.id = property_id and can_write_entity(p.entity_id)));
