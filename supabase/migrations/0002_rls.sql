-- Row level security.
--
-- Written on day one, not retrofitted at phase 5. Adding a second user then
-- costs one row in entity_access, not a migration and an audit.
--
-- Every table is keyed on entity_access, directly or through a join. Household
-- tables are visible where the user can see ANY entity in that household.

alter table users enable row level security;
alter table households enable row level security;
alter table entities enable row level security;
alter table entity_access enable row level security;
alter table officers_and_holdings enable row level security;
alter table association_determinations enable row level security;
alter table accounting_periods enable row level security;
alter table entity_period_activity enable row level security;
alter table obligations enable row level security;
alter table ct_computations enable row level security;
alter table vat_returns enable row level security;
alter table paye_periods enable row level security;
alter table employment_allowance_claims enable row level security;
alter table income_sources enable row level security;
alter table form17_declarations enable row level security;
alter table cgt_disposals enable row level security;
alter table allowance_usage enable row level security;
alter table beneficiaries enable row level security;
alter table gifts enable row level security;
alter table normal_expenditure_schedule enable row level security;
alter table estate_assets enable row level security;
alter table tasks enable row level security;
alter table correspondence enable row level security;
alter table documents enable row level security;
alter table payments enable row level security;
alter table xero_connections enable row level security;
alter table xero_raw enable row level security;
alter table sync_log enable row level security;
alter table audit_log enable row level security;
alter table tax_rates enable row level security;

-- Helper: can the current user see this entity at all?
create or replace function can_read_entity(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from entity_access ea
    where ea.entity_id = target and ea.user_id = auth.uid()
  );
$$;

-- Helper: can the current user write to this entity?
create or replace function can_write_entity(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from entity_access ea
    where ea.entity_id = target and ea.user_id = auth.uid() and ea.role = 'owner'
  );
$$;

-- Helper: household visibility, via any entity in it.
create or replace function can_read_household(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from entities e
    join entity_access ea on ea.entity_id = e.id
    where e.household_id = target and ea.user_id = auth.uid()
  );
$$;

-- users: you see yourself.
create policy users_self on users
  for all using (id = auth.uid()) with check (id = auth.uid());

-- entity_access: you see your own grants.
create policy entity_access_self on entity_access
  for select using (user_id = auth.uid());

-- entities
create policy entities_read on entities
  for select using (can_read_entity(id));
create policy entities_write on entities
  for all using (can_write_entity(id)) with check (can_write_entity(id));

-- households
create policy households_read on households
  for select using (can_read_household(id));
create policy households_write on households
  for all using (can_read_household(id)) with check (can_read_household(id));

-- Entity-scoped tables, read and write on the same key.
do $$
declare
  t text;
  entity_tables text[] := array[
    'accounting_periods','entity_period_activity','obligations','vat_returns',
    'paye_periods','income_sources','cgt_disposals','allowance_usage',
    'estate_assets','correspondence','documents','payments','xero_connections',
    'xero_raw','sync_log','normal_expenditure_schedule'
  ];
begin
  foreach t in array entity_tables loop
    execute format(
      'create policy %1$s_read on %1$s for select using (can_read_entity(entity_id));', t);
    execute format(
      'create policy %1$s_write on %1$s for all using (can_write_entity(entity_id)) with check (can_write_entity(entity_id));', t);
  end loop;
end $$;

-- tasks: entity_id is nullable (cross-entity tasks), so treat null as visible
-- to any authenticated user of this single-tenant instance.
create policy tasks_read on tasks
  for select using (entity_id is null or can_read_entity(entity_id));
create policy tasks_write on tasks
  for all using (entity_id is null or can_write_entity(entity_id))
  with check (entity_id is null or can_write_entity(entity_id));

-- ct_computations: keyed through accounting_periods.
create policy ct_computations_read on ct_computations
  for select using (exists (
    select 1 from accounting_periods p
    where p.id = ct_computations.period_id and can_read_entity(p.entity_id)));
create policy ct_computations_write on ct_computations
  for all using (exists (
    select 1 from accounting_periods p
    where p.id = ct_computations.period_id and can_write_entity(p.entity_id)))
  with check (exists (
    select 1 from accounting_periods p
    where p.id = ct_computations.period_id and can_write_entity(p.entity_id)));

-- officers_and_holdings: visible if you can see either side.
create policy officers_read on officers_and_holdings
  for select using (
    can_read_entity(individual_entity_id) or can_read_entity(company_entity_id));
create policy officers_write on officers_and_holdings
  for all using (can_write_entity(company_entity_id))
  with check (can_write_entity(company_entity_id));

-- gifts: keyed on the donor.
create policy gifts_read on gifts
  for select using (can_read_entity(donor_entity_id));
create policy gifts_write on gifts
  for all using (can_write_entity(donor_entity_id))
  with check (can_write_entity(donor_entity_id));

-- Household-scoped tables.
create policy beneficiaries_read on beneficiaries
  for select using (household_id is null or can_read_household(household_id));
create policy beneficiaries_write on beneficiaries
  for all using (household_id is null or can_read_household(household_id))
  with check (household_id is null or can_read_household(household_id));

create policy form17_read on form17_declarations
  for select using (can_read_household(household_id));
create policy form17_write on form17_declarations
  for all using (can_read_household(household_id))
  with check (can_read_household(household_id));

-- association_determinations: visible if you can see any entity named in it.
create policy association_read on association_determinations
  for select using (exists (
    select 1 from unnest(associated_entity_ids) as e(id) where can_read_entity(e.id)));
create policy association_write on association_determinations
  for all using (exists (
    select 1 from unnest(associated_entity_ids) as e(id) where can_write_entity(e.id)))
  with check (exists (
    select 1 from unnest(associated_entity_ids) as e(id) where can_write_entity(e.id)));

-- employment_allowance_claims: keyed on the claimant.
create policy ea_claims_read on employment_allowance_claims
  for select using (can_read_entity(claimant_entity_id));
create policy ea_claims_write on employment_allowance_claims
  for all using (can_write_entity(claimant_entity_id))
  with check (can_write_entity(claimant_entity_id));

-- Rates are reference data: readable by any authenticated user, written by
-- service role only (no policy for write means RLS blocks it).
create policy tax_rates_read on tax_rates
  for select using (auth.uid() is not null);

-- Audit log is append-only from the application's point of view.
create policy audit_read on audit_log
  for select using (auth.uid() is not null);
