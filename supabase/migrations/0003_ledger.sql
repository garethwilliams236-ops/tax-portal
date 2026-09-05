-- Ardent Tax Portal — the ledger
-- Migration 0003.
--
-- 0001 had return tables and a payments table, but nothing tied them together:
-- obligations.amount_due was a free-standing number, payments were matched by
-- tax type rather than allocated to a debt, and "outstanding" existed nowhere.
-- The status ladder let an obligation reach 'paid' having never been 'filed'.
--
-- This migration puts the real sequence into the schema and enforces it:
--
--     tax_returns  ->  liabilities  ->  payment_allocations
--     (declares)       (the debt)       (settles it)
--
-- Outstanding is a view over that, never a stored status. A charge cannot
-- exist without the filed return that declared it (trigger below), so there is
-- no path by which the portal can show money owing that no return reported.

-- ---------------------------------------------------------------------------
-- 1. Returns — the declaration
-- ---------------------------------------------------------------------------

create table tax_returns (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  tax_type text not null check (tax_type in ('CT','VAT','PAYE','SA','CGT')),
  -- The period this return reports. Tax-year string for SA ('2025-26'), the
  -- period end date for everything else. One return per period per tax.
  period_key text not null,
  period_start date,
  period_end date not null,
  file_by date not null,
  pay_by date not null,

  status text not null default 'not_started'
    check (status in ('not_started','in_progress','ready_to_file','filed')),

  -- The declared figure. This is the authoritative liability once filed and it
  -- supersedes any estimate. NOT a nullable convenience: see the trigger.
  declared_amount numeric(14,2),
  filed_on date,
  submission_reference text,

  -- What the engine (or Xero) thought before filing. Kept afterwards so the
  -- variance is visible rather than silently overwritten.
  estimate_amount numeric(14,2),
  estimate_source text check (estimate_source in ('engine','xero_derived','hmrc','manual')),
  variance numeric(14,2) generated always as (declared_amount - estimate_amount) stored,

  -- Link back to the detailed computation, where there is one.
  ct_computation_id uuid references ct_computations(id) on delete set null,
  vat_return_id uuid references vat_returns(id) on delete set null,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (entity_id, tax_type, period_key),
  -- A filed return declares an amount. Without one it charges nothing, which
  -- is the exact failure this migration exists to remove.
  constraint filed_returns_declare_an_amount
    check (status <> 'filed' or (declared_amount is not null and filed_on is not null))
);
create index tax_returns_entity_idx on tax_returns (entity_id, tax_type, period_key);
create index tax_returns_open_idx on tax_returns (file_by) where status <> 'filed';

-- ---------------------------------------------------------------------------
-- 2. Liabilities — the debt
-- ---------------------------------------------------------------------------

create table liabilities (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  tax_type text not null,
  period_key text,

  kind text not null check (kind in (
    -- charged BY a return
    'return_charge','balancing_payment',
    -- charged by statute IN ADVANCE of a return
    'payment_on_account','quarterly_instalment',
    -- charged outside the return cycle
    'interest','penalty','hmrc_amendment','other')),

  label text not null,
  detail text,
  amount numeric(14,2) not null,
  due_date date not null,

  -- Set for anything a return declared. Enforced by the trigger below.
  return_id uuid references tax_returns(id) on delete cascade,

  -- Instalments are charged on an estimate by design: the money is due long
  -- before the return exists. Flagged so the UI never presents one as declared.
  is_estimated boolean not null default false,

  created_at timestamptz not null default now(),
  unique (entity_id, tax_type, period_key, kind, due_date)
);
create index liabilities_entity_idx on liabilities (entity_id, tax_type);
create index liabilities_due_idx on liabilities (due_date);

-- A charge that a return declared must name that return, and that return must
-- actually be filed with a figure. This is the constraint that makes the
-- process real rather than advisory.
create or replace function liabilities_require_a_filed_return() returns trigger
language plpgsql as $$
declare r record;
begin
  if new.kind in ('return_charge','balancing_payment') then
    if new.return_id is null then
      raise exception 'A % must reference the return that declared it', new.kind;
    end if;
    select status, declared_amount into r from tax_returns where id = new.return_id;
    if r.status <> 'filed' or r.declared_amount is null then
      raise exception 'Cannot charge % against a return that is not filed with a declared amount', new.kind;
    end if;
  end if;
  -- Payments on account and instalments arise WITHOUT a return, by statute.
  if new.kind in ('payment_on_account','quarterly_instalment') and new.return_id is not null then
    raise exception '% is charged by statute, not by a return', new.kind;
  end if;
  return new;
end $$;

create trigger liabilities_sequence
  before insert or update on liabilities
  for each row execute function liabilities_require_a_filed_return();

-- ---------------------------------------------------------------------------
-- 3. Allocation — payments settle named debts
-- ---------------------------------------------------------------------------

-- payments.obligation_id in 0001 was nullable and unused. Allocation is
-- many-to-many in practice: one payment can clear two quarters, and one
-- liability can be settled by three payments.
alter table payments add column if not exists reference_period text;
comment on column payments.obligation_id is
  'Deprecated by payment_allocations. Retained for rows created before 0003.';

create table payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  liability_id uuid not null references liabilities(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  allocated_at timestamptz not null default now(),
  unique (payment_id, liability_id)
);
create index payment_allocations_liab_idx on payment_allocations (liability_id);

-- You cannot allocate more of a payment than the payment was for. Anything
-- left over is money on account, which is a real position and is reported as
-- such rather than being quietly treated as nothing to pay.
create or replace function payment_allocations_within_payment() returns trigger
language plpgsql as $$
declare paid numeric(14,2); alloc numeric(14,2); ent_p uuid; ent_l uuid;
begin
  select amount, entity_id into paid, ent_p from payments where id = new.payment_id;
  select entity_id into ent_l from liabilities where id = new.liability_id;
  if ent_p <> ent_l then
    raise exception 'A payment cannot be allocated to another entity''s liability';
  end if;
  select coalesce(sum(amount),0) into alloc from payment_allocations
    where payment_id = new.payment_id and id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);
  if alloc + new.amount > paid + 0.005 then
    raise exception 'Allocating % would exceed the payment of %', alloc + new.amount, paid;
  end if;
  return new;
end $$;

create trigger payment_allocations_bounds
  before insert or update on payment_allocations
  for each row execute function payment_allocations_within_payment();

-- ---------------------------------------------------------------------------
-- 4. Outstanding is a view, not a status
-- ---------------------------------------------------------------------------

create view liability_balances as
select l.*,
       coalesce(sum(case when p.direction = 'from_hmrc' then -a.amount else a.amount end), 0)
         as allocated,
       l.amount - coalesce(sum(case when p.direction = 'from_hmrc' then -a.amount else a.amount end), 0)
         as outstanding,
       (l.due_date < current_date
        and l.amount - coalesce(sum(case when p.direction = 'from_hmrc' then -a.amount else a.amount end), 0) > 0.005)
         as is_overdue
from liabilities l
left join payment_allocations a on a.liability_id = l.id
left join payments p on p.id = a.payment_id
group by l.id;

-- Money paid over and above any named debt. Real, and not the same thing as
-- having nothing to pay.
create view credit_on_account as
select p.entity_id, p.tax_type,
       sum(case when p.direction = 'from_hmrc' then -1 else 1 end
           * (p.amount - coalesce(al.allocated, 0))) as credit
from payments p
left join (select payment_id, sum(amount) as allocated
           from payment_allocations group by payment_id) al on al.payment_id = p.id
group by p.entity_id, p.tax_type;

-- The dashboard's single query: where each tax has got to in the sequence.
create view tax_account as
select e.id as entity_id, e.name as entity_name, b.tax_type,
       count(*) filter (where b.outstanding > 0.005)               as open_charges,
       sum(b.amount)                                                as charged,
       sum(b.allocated)                                             as paid,
       sum(b.outstanding)                                           as outstanding,
       sum(b.outstanding) filter (where b.is_overdue)               as overdue,
       min(b.due_date) filter (where b.outstanding > 0.005)         as next_due,
       coalesce(max(c.credit), 0)                                   as credit,
       (select max(r.period_end) from tax_returns r
         where r.entity_id = e.id and r.tax_type = b.tax_type and r.status = 'filed')
                                                                    as last_return_filed,
       (select count(*) from tax_returns r
         where r.entity_id = e.id and r.tax_type = b.tax_type
           and r.status <> 'filed' and r.file_by < current_date)    as returns_not_filed
from entities e
join liability_balances b on b.entity_id = e.id
left join credit_on_account c on c.entity_id = e.id and c.tax_type = b.tax_type
group by e.id, e.name, b.tax_type;

-- ---------------------------------------------------------------------------
-- 5. The old ladder no longer decides anything
-- ---------------------------------------------------------------------------
-- obligations remains the CALENDAR: what falls due, when, and under which
-- statute. It no longer holds the money. amount_due stays as the derived
-- estimate that drives forecasting, and is explicitly not a debt.
comment on column obligations.amount_due is
  'Estimate only. The charged amount lives in liabilities, which exists only '
  'because a return declared it or statute charged it. Never present this as owed.';
comment on column obligations.status is
  'Calendar state. For a declaring obligation the truth is tax_returns.status; '
  'for a payment obligation it is liability_balances.outstanding.';

-- ---------------------------------------------------------------------------
-- 6. Row level security for the new tables
-- ---------------------------------------------------------------------------
alter table tax_returns enable row level security;
alter table liabilities enable row level security;
alter table payment_allocations enable row level security;

create policy tax_returns_read on tax_returns
  for select using (can_read_entity(entity_id));
create policy tax_returns_write on tax_returns
  for all using (can_write_entity(entity_id))
  with check (can_write_entity(entity_id));

create policy liabilities_read on liabilities
  for select using (can_read_entity(entity_id));
create policy liabilities_write on liabilities
  for all using (can_write_entity(entity_id))
  with check (can_write_entity(entity_id));

-- Allocation rights follow the payment's entity.
create policy payment_allocations_read on payment_allocations
  for select using (exists (
    select 1 from payments p where p.id = payment_id and can_read_entity(p.entity_id)));
create policy payment_allocations_write on payment_allocations
  for all using (exists (
    select 1 from payments p where p.id = payment_id and can_write_entity(p.entity_id)))
  with check (exists (
    select 1 from payments p where p.id = payment_id and can_write_entity(p.entity_id)));
