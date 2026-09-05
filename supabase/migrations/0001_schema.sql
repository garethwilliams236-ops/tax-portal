-- Ardent Tax Portal — core schema
-- Migration 0001. RLS policies are in 0002; seed data with placeholders in seed.sql.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- People and access
-- ---------------------------------------------------------------------------

create table users (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

-- Couples are first-class: transferable NRB/RNRB, spouse exemption,
-- no-gain-no-loss transfers and Form 17 are all household-level concepts.
create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  marriage_date date,
  created_at timestamptz not null default now()
);

create table entities (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  type text not null check (type in ('company','individual')),
  household_id uuid references households(id) on delete set null,

  -- company fields
  company_number text,
  utr text,
  vrn text,
  paye_reference text,
  accounts_office_reference text,
  year_end_month int check (year_end_month between 1 and 12),
  year_end_day int check (year_end_day between 1 and 31),
  vat_registered boolean not null default false,
  vat_scheme text check (vat_scheme in ('standard','cash','flat_rate','annual')),
  vat_stagger text,
  -- 'trading' | 'non_trading' | 'dormant' — drives which obligations are generated.
  -- NOTE: this is the Companies House / operational status. It does NOT decide
  -- associated-company status; that is entity_period_activity (CTA 2010 s.18E).
  trading_status text not null default 'trading'
    check (trading_status in ('trading','non_trading','dormant')),
  is_close_investment_holding_company boolean not null default false,

  -- individual fields
  ni_number text,
  date_of_birth date,
  is_long_term_uk_resident boolean not null default true,

  tax_regime text not null default 'rUK' check (tax_regime in ('rUK','scotland')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table entity_access (
  user_id uuid not null references users(id) on delete cascade,
  entity_id uuid not null references entities(id) on delete cascade,
  role text not null check (role in ('owner','viewer')),
  primary key (user_id, entity_id)
);

-- ---------------------------------------------------------------------------
-- Officers, shareholdings, and association
-- ---------------------------------------------------------------------------

-- Drives dividend attribution, Employment Allowance eligibility, BADR
-- qualification and BPR. Effective-dated because the 2-year clocks run on it.
create table officers_and_holdings (
  id uuid primary key default gen_random_uuid(),
  individual_entity_id uuid not null references entities(id) on delete cascade,
  company_entity_id uuid not null references entities(id) on delete cascade,
  is_director boolean not null default false,
  is_employee boolean not null default false,
  appointed_on date,
  resigned_on date,
  share_class text,
  ordinary_share_pct numeric(7,4),
  voting_rights_pct numeric(7,4),
  distributable_profits_pct numeric(7,4),
  winding_up_assets_pct numeric(7,4),
  -- ITTOIA 2005 s.626 outright-gift evidence (Jones v Garnett): shares must be
  -- ordinary shares carrying votes, full dividend rights AND capital on a
  -- winding up, gifted unconditionally with no reversion.
  full_ordinary_rights boolean,
  acquired_on date,
  acquisition_basis text check (acquisition_basis in ('subscription','spousal_gift','purchase','other')),
  -- Date from which ALL BADR conditions have been continuously satisfied.
  badr_conditions_met_since date,
  notes text
);

-- Association is a recorded JUDGEMENT (control + substantial commercial
-- interdependence), not a computed fact. The portal records it and applies it
-- consistently; it does not decide it.
create table association_determinations (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  effective_to date,
  associated_entity_ids uuid[] not null,
  basis text not null
    check (basis in ('common_control','commercial_interdependence','not_associated')),
  reasoning text not null,
  reviewed_by text,
  reviewed_on date,
  created_at timestamptz not null default now()
);

create table accounting_periods (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  -- 24-month backfill window means some periods are incomplete. Suppress
  -- variance percentages against anything not 'full'.
  completeness text not null default 'full'
    check (completeness in ('full','partial','pre_window')),
  status text not null default 'open' check (status in ('open','closed','filed')),
  check (end_date >= start_date)
);

-- The s.18E(3) disregard is tested PER ACCOUNTING PERIOD, per company, and it
-- is the SUBJECT company's period that governs — not the associate's year end.
-- This cannot be a static flag on `entities`.
create table entity_period_activity (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  subject_period_id uuid not null references accounting_periods(id) on delete cascade,
  carried_on_trade_or_business boolean not null,
  first_activity_date date,
  basis text not null
    check (basis in ('no_activity','bank_interest_only','s18F_passive_holding','trading')),
  reasoning text not null,
  unique (entity_id, subject_period_id)
);

-- ---------------------------------------------------------------------------
-- Obligations — one table, because the cross-entity dashboard is one query
-- ---------------------------------------------------------------------------

create table obligations (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  tax_type text not null check (tax_type in (
    'CT','VAT','PAYE','SA','MTD_ITSA','CGT_60DAY','P11D','CIS','IHT',
    'CONFIRMATION_STATEMENT','ACCOUNTS','CT_NOTIFICATION','FORM_17','EA_REVIEW')),
  kind text not null check (kind in ('filing','payment','submission','report','decision')),
  period_start date,
  period_end date,
  due_date date not null,
  amount_due numeric(14,2),
  -- Statuses reflect self-filing: draft through to acknowledged.
  status text not null default 'not_started' check (status in (
    'not_started','in_progress','ready_to_file','filed','acknowledged',
    'paid','part_paid','overdue','not_required')),
  submission_reference text,
  filed_on date,
  hmrc_period_key text,
  -- Keyed to the OBLIGATION's tax year, not today's date: classic SA penalties
  -- still apply to pre-MTD years after you join MTD.
  penalty_regime text check (penalty_regime in ('sa_classic','mtd_points','none')),
  -- Some deadlines cannot be recovered if missed (Form 17's 60 days).
  is_unextendable boolean not null default false,
  source text not null default 'derived' check (source in ('derived','hmrc','manual')),
  created_at timestamptz not null default now()
);

create index obligations_due_idx on obligations (due_date) where status not in ('filed','paid','not_required');
create index obligations_entity_idx on obligations (entity_id);

-- ---------------------------------------------------------------------------
-- Corporate computations
-- ---------------------------------------------------------------------------

create table ct_computations (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references accounting_periods(id) on delete cascade,
  profit_before_tax numeric(14,2),
  add_backs jsonb not null default '{}'::jsonb,
  deductions jsonb not null default '{}'::jsonb,
  taxable_profit numeric(14,2),
  augmented_profit numeric(14,2),
  association_determination_id uuid references association_determinations(id),
  association_divisor int,
  lower_limit numeric(14,2),
  upper_limit numeric(14,2),
  tax_at_main_rate numeric(14,2),
  marginal_relief numeric(14,2),
  tax_due numeric(14,2),
  effective_rate numeric(6,4),
  qip_threshold numeric(14,2),
  qip_applies boolean,
  -- NOT NULL: the assistant explains YOUR number, not the general rule, and
  -- that only works if every step is persisted.
  workings jsonb not null,
  computed_at timestamptz not null default now()
);

create table vat_returns (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  hmrc_period_key text,
  box1 numeric(14,2), box2 numeric(14,2), box3 numeric(14,2), box4 numeric(14,2),
  box5 numeric(14,2), box6 numeric(14,2), box7 numeric(14,2), box8 numeric(14,2),
  box9 numeric(14,2),
  -- Xero has no UK VAT return endpoint, so derive from journals AND retrieve
  -- the filed return from HMRC, then show the variance.
  source text not null check (source in ('xero_derived','hmrc_filed','manual')),
  filed_at timestamptz,
  variance_notes text
);

create table paye_periods (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  tax_year text not null,
  tax_month int not null check (tax_month between 1 and 12),
  gross_pay numeric(14,2),
  income_tax numeric(14,2),
  employee_nic numeric(14,2),
  employer_nic numeric(14,2),
  employment_allowance_used numeric(14,2),
  student_loan numeric(14,2),
  apprenticeship_levy numeric(14,2),
  total_due numeric(14,2),
  rti_submitted_at timestamptz,
  unique (entity_id, tax_year, tax_month)
);

-- Only ONE Employment Allowance across connected companies (NICA 2014 s.3),
-- tested at the beginning of the tax year.
create table employment_allowance_claims (
  id uuid primary key default gen_random_uuid(),
  tax_year text not null,
  claimant_entity_id uuid not null references entities(id) on delete cascade,
  connected_entity_ids uuid[] not null default '{}',
  amount numeric(14,2) not null,
  reasoning text,
  unique (tax_year)
);

-- ---------------------------------------------------------------------------
-- Personal
-- ---------------------------------------------------------------------------

create table income_sources (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  tax_year text not null,
  kind text not null check (kind in
    ('employment','dividend','property','pension','savings','trading','other')),
  source_entity_id uuid references entities(id) on delete set null,
  description text,
  gross numeric(14,2) not null default 0,
  tax_deducted numeric(14,2) not null default 0,
  allowable_expenses numeric(14,2) not null default 0,
  finance_costs numeric(14,2) not null default 0,
  -- Jointly held property is 50/50 by default (ITA 2007 s.836) unless a Form 17
  -- declaration is in force. Close company shares are Exception D — actual
  -- entitlement always, no Form 17 possible.
  ownership_pct numeric(7,4) not null default 100,
  form17_declaration_id uuid,
  notes text
);

create table form17_declarations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  property_description text not null,
  deed_of_trust_dated date,
  declaration_dated date not null,
  -- 60 days from the DECLARATION date. No power to extend (TSEM9862).
  must_reach_hmrc_by date generated always as (declaration_dated + 60) stored,
  submitted_on date,
  beneficial_split jsonb not null,
  status text not null default 'pending'
    check (status in ('pending','submitted','accepted','lapsed'))
);

create table cgt_disposals (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  tax_year text not null,
  asset_description text not null,
  asset_class text not null
    check (asset_class in ('shares','residential_property','other_property','other')),
  acquired_on date,
  disposed_on date not null,
  proceeds numeric(14,2) not null,
  base_cost numeric(14,2) not null,
  costs_of_disposal numeric(14,2) not null default 0,
  gain numeric(14,2),
  relief_claimed text check (relief_claimed in ('BADR','PRR','gift_holdover','rollover')),
  relief_amount numeric(14,2),
  -- 60-day reporting for UK residential property runs separately from SA.
  reporting_route text check (reporting_route in ('60_day','self_assessment')),
  reported_on date
);

create table allowance_usage (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  tax_year text not null,
  allowance text not null check (allowance in
    ('pension_aa','isa','cgt_aea','dividend','psa','iht_annual','badr_lifetime')),
  limit_amount numeric(14,2),
  used_amount numeric(14,2) not null default 0,
  carry_forward_from text[],
  -- Drives the planning nudges: unused pension AA and the IHT annual exemption
  -- expire, and the loss is unrecoverable.
  expires_on date,
  unique (entity_id, tax_year, allowance)
);

-- ---------------------------------------------------------------------------
-- Estate
-- ---------------------------------------------------------------------------

create table beneficiaries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references households(id) on delete cascade,
  name text not null,
  relationship text not null
    check (relationship in ('child','grandchild','spouse','charity','other')),
  -- RNRB requires a qualifying residence closely inherited by a LINEAL
  -- descendant. Nieces, nephews and siblings do not qualify.
  lineal_descendant boolean not null default false,
  date_of_birth date,
  notes text
);

create table gifts (
  id uuid primary key default gen_random_uuid(),
  donor_entity_id uuid not null references entities(id) on delete cascade,
  beneficiary_id uuid references beneficiaries(id) on delete set null,
  gift_date date not null,
  value numeric(14,2) not null,
  classification text not null check (classification in (
    'PET','CLT','exempt_annual','exempt_small','exempt_wedding',
    'exempt_normal_expenditure','exempt_spouse','exempt_charity')),
  reservation_of_benefit boolean not null default false,
  -- Normal expenditure out of income is claimed on IHT403 AFTER death, by
  -- executors, from records kept contemporaneously. This is the evidence link.
  income_evidence_ref text,
  seven_year_clear_on date generated always as ((gift_date + interval '7 years')::date) stored,
  notes text
);

-- Contemporaneous income vs expenditure schedule supporting normal-expenditure
-- claims. Arguably the most valuable thing in the estate module.
create table normal_expenditure_schedule (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  tax_year text not null,
  net_income numeric(14,2) not null,
  usual_expenditure numeric(14,2) not null,
  gifts_made numeric(14,2) not null default 0,
  surplus numeric(14,2) generated always as (net_income - usual_expenditure - gifts_made) stored,
  evidence_document_id uuid,
  notes text,
  unique (entity_id, tax_year)
);

create table estate_assets (
  id uuid primary key default gen_random_uuid(),
  owner_entity_id uuid not null references entities(id) on delete cascade,
  category text not null check (category in (
    'main_residence','business','shares_listed','shares_aim','shares_unquoted',
    'pension','property','cash','chattels','other')),
  description text not null,
  value numeric(14,2) not null,
  valued_on date not null,
  ownership_share numeric(5,4) not null default 1.0,
  relief_class text check (relief_class in ('BPR_100','BPR_50','APR_100','APR_50')),
  -- s.112 excepted assets: not used wholly or mainly for the business AND not
  -- required for future business use. Reduces the relieved value proportionately.
  excepted_asset_value numeric(14,2) not null default 0,
  relief_notes text,
  -- Dated rule, not a boolean assumption: unused pension funds come into the
  -- estate for deaths on or after 6 April 2027.
  in_estate_for_iht_from date,
  in_estate_for_iht boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------

create table tasks (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references entities(id) on delete cascade,
  title text not null,
  detail text,
  origin text not null check (origin in ('nudge','manual','advisor')),
  rule_key text,
  period_key text,
  category text check (category in ('filing','payment','planning','data','correspondence','structural')),
  priority int not null default 3 check (priority between 1 and 5),
  due_date date,
  status text not null default 'open' check (status in ('open','done','snoozed','dismissed')),
  snoozed_until date,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  -- The single most important constraint here: re-evaluation UPDATES rather
  -- than duplicates. A nudge engine that spams is one you turn off in a fortnight.
  unique (entity_id, rule_key, period_key)
);

create table correspondence (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  tax_type text,
  direction text not null check (direction in ('inbound','outbound')),
  channel text not null check (channel in ('letter','email','phone','portal')),
  occurred_on date not null,
  counterparty text,
  subject text not null,
  summary text,
  response_due date,
  response_status text not null default 'none'
    check (response_status in ('none','pending','sent','closed')),
  document_id uuid,
  created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  category text check (category in
    ('return','computation','accounts','hmrc_notice','deed','evidence','other')),
  tax_type text,
  period_label text,
  storage_path text not null,
  filename text not null,
  uploaded_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  obligation_id uuid references obligations(id) on delete set null,
  tax_type text not null,
  amount numeric(14,2) not null,
  paid_on date not null,
  direction text not null check (direction in ('to_hmrc','from_hmrc')),
  reference text,
  source text not null default 'manual' check (source in ('manual','hmrc','bank'))
);

-- ---------------------------------------------------------------------------
-- Integrations
-- ---------------------------------------------------------------------------

create table xero_connections (
  entity_id uuid primary key references entities(id) on delete cascade,
  tenant_id text not null,
  tenant_name text,
  refresh_token text not null,
  scopes text[],
  last_sync_at timestamptz,
  sync_status text
);

-- Raw payloads before transformation. When a figure looks wrong at 11pm you
-- will want the payload.
create table xero_raw (
  id bigserial primary key,
  entity_id uuid not null references entities(id) on delete cascade,
  endpoint text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now()
);

create table sync_log (
  id bigserial primary key,
  entity_id uuid references entities(id) on delete cascade,
  provider text not null check (provider in ('xero','hmrc')),
  endpoint text,
  status text,
  message text,
  ran_at timestamptz not null default now()
);

-- Rates as DATED ROWS, never constants. See src/lib/tax/rates.ts for the seed
-- shape. Correcting the APR/BPR allowance must be a data change, not a code change.
create table tax_rates (
  id uuid primary key default gen_random_uuid(),
  regime text not null,
  effective_from date not null,
  effective_to date,
  payload jsonb not null,
  source_citation text,
  verified_on date,
  unique (regime, effective_from)
);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

create table audit_log (
  id bigserial primary key,
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('insert','update','delete')),
  changed_by uuid references users(id),
  old_value jsonb,
  new_value jsonb,
  changed_at timestamptz not null default now()
);
