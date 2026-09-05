# Ardent Tax Portal — Build Spec

**Owner:** Gareth Williams · **Date:** 31 August 2026 · **Status:** Draft v0.9 — payroll and property figures per tax year; — Ivor built and grounded; return-first ledger: liabilities are declared by a return, payments are allocated to them, outstanding is arithmetic

A tool for a chartered accountant managing his own affairs: Corporation Tax, VAT, PAYE/NICs
across companies he owns, plus his personal position — income tax, capital gains, and
estate planning. He files everything himself. Xero is the accounting source; HMRC's MTD
APIs are the source of truth for filed positions. The portal is the layer neither provides:
cross-entity visibility, deadline and planning control, computation workings, correspondence
history, and an embedded process assistant that nudges.

**User profile drives design.** You are a chartered accountant filing your own returns. This
is not a tool that explains tax to a layman or defers to a professional — you are the
professional. That means: full workings shown in professional form, statutory and manual
references rather than plain-English paraphrase, no "consult your accountant" escape hatch,
and an assistant that flags where a position is a judgement call and cites the competing
authority rather than declining to engage.

---

## 1. Scope

**In:** computation, obligation tracking, deadline and planning control, correspondence,
document management, cross-entity analysis, and a process assistant.

**Out for now:** direct filing. It requires HMRC-recognised software status, fraud-prevention
header compliance and ongoing obligations. Since you file yourself through HMRC's own
services, the portal's job is to get the numbers right and tell you when — then record what
you submitted. Nothing here forecloses adding submission later.

**Out permanently:** bookkeeping. Xero does it. The portal reads from Xero and never writes.

### The three structural bets

**One: associated companies.** Two companies today — one trading, one dormant, both owned by
you — and more over time. The £50,000/£250,000 Corporation Tax limits divide by the number of
associated companies, as do the £1.5m/£20m instalment thresholds.

Your reading is right, and the statute is worth being precise about because the wording is
not what people assume. **CTA 2010 s.18E(3)** disregards an associated company that "has not
carried on a trade or business at any time in the accounting period." The test is **not
"dormant"** — dormancy under CA 2006 s.1169 is a different test for a different purpose, and
the two statuses diverge routinely. Argue non-trading to HMRC, never dormancy. The good news
is that the tax test is often more forgiving: a company holding cash on deposit and earning
only bank interest is **not** carrying on a business (*Jowett v O'Neill & Brennan
Construction* [1998] STC 482), even though GOV.UK's separate "active for Corporation Tax"
guidance treats earning interest as making a company active. Different tests, different
purposes — do not let them be conflated.

So today: one associated company, full £50,000/£250,000 limits on the trading company. That
holds only while the dormant company carries on no trade or business.

Association is otherwise a *judgement* — control plus substantial commercial interdependence.
The portal must not decide it. It records **your determination, with reasoning,
effective-dated**, and applies it consistently. That is the audit trail you will want if HMRC
asks, and the design that survives companies three and four.

**Two: the trade-start trap, which is the single most valuable thing this portal can tell
you.** s.18E(1) counts a company as associated for the whole accounting period if it is
associated for **any part** of it, and the s.18E(3) disregard survives only if there was no
trade or business at **any time** in the period. HMRC state it plainly at CTM03956:
"companies are treated as associated companies for the whole period even if they are
associated for only part of it." There is no apportionment.

**One day of trading in the dormant company halves the trading company's limits for that
entire accounting period, retrospectively.** Start trading on 1 March with a 31 March year
end and the whole year runs on £25,000/£125,000. Where you control the start date — and with
a company you own and currently keep dormant, you do — starting on the first day of the
trading company's next accounting period confines the effect to a period you planned for.

That is a decision worth thousands, it is invisible in Xero, and no single-company tool will
ever surface it. Build the nudge (section 9) and the what-if (section 5.1) that make it
visible before you act, not after.

**Three: build for N entities from row one.** An entity is a row, never a code branch. Two
companies is the worst possible number to design for, because it tempts hard-coding. Every
query, component and calculation takes an entity set — and your wife is an entity too
(section 7.1), which means "personal" was never singular either.

---

## 2. Architecture

Same stack as the Ardent CRM — proven workflow, transferable RLS patterns.

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router), React, TypeScript |
| UI | Tailwind + shadcn/ui |
| Database | Supabase (Postgres) + pgvector |
| Auth | Supabase Auth, RLS from day one |
| Files | Supabase Storage, private buckets |
| Hosting | Vercel |
| Jobs | Vercel Cron → route handlers |
| Assistant | Claude API, server-side |

```
~/projects/tax_portal/
  web/
    app/
      (dash)/                 cross-entity dashboard
      entity/[slug]/          per-entity tabs
      personal/               personal + estate modules
      api/{xero,hmrc,advisor,nudges}/
    docs/                     MDX — the assistant's process corpus (section 13)
    lib/
      tax/                    pure functions, no I/O, fully unit tested
      xero/  hmrc/  nudges/
  supabase/migrations/
```

`lib/tax/` holds every rate, threshold and formula as pure tested functions. Rates live as
**dated rows in a `tax_rates` table**, never constants — you are maintaining this across tax
years, and 2027/28 already brings a four-way rate split (section 6).

---

## 3. Navigation

**Cross-entity dashboard** — the daily view:

- Next 90 days of obligations across every entity, one list
- Total cash due by month, across all entities plus personal
- Associated-company position and its live effect on each company's CT rate
- Overdue, in red, at the top
- **Open tasks and nudges** (section 9)
- Correspondence awaiting a response

**Corporate entity tabs** (identical structure, driven by the same components):

```
Overview · Corporation Tax · VAT · PAYE & NIC · Payments
Correspondence · Documents · Details
```

**Personal tabs — one each for you and your wife**, same components, plus a **Household** view
above them for the joint estate position (section 7.1):

```
Overview          liabilities, deadlines, effective rate, marginal rate position
Income            employment · dividends · property · pension · savings
Capital Gains     disposals, reliefs, 60-day property reporting
Self Assessment   return workings, payments on account, balancing payment
Allowances        PA taper, pension AA and carry forward, ISA, PSA, dividend, AEA
Estate Planning   individual gift ledger and estate assets, feeding Household
MTD               inactive until you cross the threshold; obligations tracked regardless
```

**Household view:** combined estate, transferable NRB and RNRB, first-death scenarios both
ways, the £2m RNRB taper position at unrelieved values, joint asset ownership and Form 17
status.

Dividends declared in a corporate entity flow automatically into personal income, split by
actual beneficial entitlement where shares are jointly held (close company shares are
Exception D — no 50/50 rule, no Form 17). That cross-reference is the reason all of this
lives in one system.

---

## 4. Data model

Core tables. `entity_id` on everything, RLS on everything.

```sql
create table users (
  id uuid primary key references auth.users,
  display_name text not null
);

create table entities (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  type text not null check (type in ('company','individual')),
  company_number text, utr text, vrn text,
  paye_reference text, accounts_office_reference text,
  year_end_month int, year_end_day int,
  vat_scheme text check (vat_scheme in ('standard','cash','flat_rate','annual')),
  vat_stagger text,
  director_count int,                    -- Employment Allowance test, section 5.3
  ni_number text,
  tax_regime text default 'rUK',         -- rUK | scotland
  household_id uuid references households(id),
  active boolean default true
);

-- Couples are a first-class concept: transferable NRB/RNRB, spouse exemption,
-- no-gain-no-loss transfers and Form 17 are all couple-level.
create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  marriage_date date,
  created_at timestamptz default now()
);

create table entity_access (
  user_id uuid references users(id),
  entity_id uuid references entities(id),
  role text not null check (role in ('owner','viewer')),
  primary key (user_id, entity_id)
);

-- Association is a recorded judgement, not a computed fact.
create table association_determinations (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null,
  effective_to date,
  associated_entity_ids uuid[] not null,
  basis text not null,          -- 'common_control' | 'commercial_interdependence' | 'not_associated'
  reasoning text not null,      -- your written analysis. Required.
  reviewed_by text, reviewed_on date,
  created_at timestamptz default now()
);

-- The s.18E(3) disregard is tested per accounting period, per company, and it is the
-- SUBJECT company's accounting period that governs — not the associate's own year end.
-- This cannot be a static flag on `entities`.
-- Who holds what in which company. Drives dividend attribution, EA eligibility,
-- BADR qualification and BPR. Effective-dated because the 2-year clocks run on it.
create table officers_and_holdings (
  id uuid primary key default gen_random_uuid(),
  individual_entity_id uuid not null references entities(id),
  company_entity_id uuid not null references entities(id),
  is_director boolean default false,
  is_employee boolean default false,
  appointed_on date, resigned_on date,
  share_class text,
  ordinary_share_pct numeric(7,4),
  voting_rights_pct numeric(7,4),
  distributable_profits_pct numeric(7,4),
  winding_up_assets_pct numeric(7,4),
  -- s.626 outright-gift evidence: full ordinary rights, no conditions, no reversion
  full_ordinary_rights boolean,
  acquired_on date,
  acquisition_basis text,        -- 'subscription' | 'spousal_gift' | 'purchase'
  notes text
);

create table entity_period_activity (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id),
  subject_period_id uuid not null references accounting_periods(id),
  carried_on_trade_or_business boolean not null,
  first_activity_date date,          -- the date that broke the disregard, if it broke
  basis text not null,               -- 'no_activity' | 'bank_interest_only' | 's18F_passive_holding' | 'trading'
  reasoning text not null,
  unique (entity_id, subject_period_id)
);

create table obligations (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id),
  tax_type text not null check (tax_type in
    ('CT','VAT','PAYE','SA','MTD_ITSA','CGT_60DAY','P11D','CIS',
     'CONFIRMATION_STATEMENT','ACCOUNTS','IHT')),
  kind text not null check (kind in ('filing','payment','submission','report')),
  period_start date, period_end date,
  due_date date not null,
  amount_due numeric(14,2),
  -- your own filing workflow, since you file
  status text not null default 'not_started' check (status in
    ('not_started','in_progress','ready_to_file','filed','acknowledged',
     'paid','part_paid','overdue','not_required')),
  submission_reference text,     -- VAT receipt, CT600 IR mark, SA submission receipt
  filed_on date,
  hmrc_period_key text,
  penalty_regime text,           -- 'sa_classic' | 'mtd_points' — keyed to the OBLIGATION's tax year
  source text default 'derived'  -- derived | hmrc | manual
);

create table accounting_periods (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id),
  start_date date not null, end_date date not null,
  completeness text default 'full' check (completeness in ('full','partial','pre_window')),
  status text default 'open'
);

create table ct_computations (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references accounting_periods(id),
  profit_before_tax numeric(14,2),
  add_backs jsonb, deductions jsonb,
  taxable_profit numeric(14,2),
  augmented_profit numeric(14,2),
  association_determination_id uuid references association_determinations(id),
  associated_count int,
  lower_limit numeric(14,2), upper_limit numeric(14,2),
  tax_at_main_rate numeric(14,2), marginal_relief numeric(14,2),
  tax_due numeric(14,2), effective_rate numeric(6,4),
  qip_threshold numeric(14,2), qip_applies boolean,
  workings jsonb not null,       -- every step, for display and for the assistant
  computed_at timestamptz default now()
);

create table vat_returns (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id),
  period_start date, period_end date, hmrc_period_key text,
  box1 numeric(14,2), box2 numeric(14,2), box3 numeric(14,2), box4 numeric(14,2),
  box5 numeric(14,2), box6 numeric(14,2), box7 numeric(14,2), box8 numeric(14,2),
  box9 numeric(14,2),
  source text check (source in ('xero_derived','hmrc_filed','manual')),
  filed_at timestamptz, variance_notes text
);

create table paye_periods (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id),
  tax_month int, tax_year text,
  gross_pay numeric(14,2), income_tax numeric(14,2),
  employee_nic numeric(14,2), employer_nic numeric(14,2),
  employment_allowance_used numeric(14,2),
  student_loan numeric(14,2), apprenticeship_levy numeric(14,2),
  total_due numeric(14,2), rti_submitted_at timestamptz
);

-- PERSONAL ------------------------------------------------------------

create table income_sources (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id),
  tax_year text not null,
  kind text not null check (kind in
    ('employment','dividend','property','pension','savings','trading','other')),
  source_entity_id uuid references entities(id),  -- dividends: which company
  description text,
  gross numeric(14,2), tax_deducted numeric(14,2),
  allowable_expenses numeric(14,2),
  finance_costs numeric(14,2),                    -- property: s.24 reducer basis
  notes text
);

create table cgt_disposals (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id),
  tax_year text not null,
  asset_description text not null,
  asset_class text check (asset_class in ('shares','residential_property','other_property','other')),
  acquired_on date, disposed_on date,
  proceeds numeric(14,2), base_cost numeric(14,2), costs_of_disposal numeric(14,2),
  gain numeric(14,2),
  relief_claimed text,          -- 'BADR' | 'PRR' | 'gift_holdover' | null
  relief_amount numeric(14,2),
  reporting_route text,         -- '60_day' | 'self_assessment'
  reported_on date
);

create table allowance_usage (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id),
  tax_year text not null,
  allowance text not null,      -- 'pension_aa','isa','cgt_aea','dividend','psa','iht_annual'
  limit_amount numeric(14,2),
  used_amount numeric(14,2),
  carry_forward_from text[],    -- source tax years, for pension AA and IHT annual exemption
  expires_on date               -- drives the planning nudges in section 9
);

-- ESTATE --------------------------------------------------------------

create table beneficiaries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  relationship text not null,   -- 'child','grandchild','spouse','charity','other'
  lineal_descendant boolean default false,   -- RNRB qualifying test
  date_of_birth date,
  notes text
);

create table gifts (
  id uuid primary key default gen_random_uuid(),
  donor_entity_id uuid not null references entities(id),
  beneficiary_id uuid references beneficiaries(id),
  gift_date date not null,
  value numeric(14,2) not null,
  classification text not null check (classification in
    ('PET','CLT','exempt_annual','exempt_small','exempt_wedding',
     'exempt_normal_expenditure','exempt_spouse','exempt_charity')),
  reservation_of_benefit boolean default false,
  -- normal expenditure out of income claims need contemporaneous evidence
  income_evidence_ref text,
  seven_year_clear_on date generated always as (gift_date + interval '7 years') stored,
  notes text
);

create table estate_assets (
  id uuid primary key default gen_random_uuid(),
  owner_entity_id uuid not null references entities(id),
  category text not null,       -- 'main_residence','business','shares_listed','shares_aim',
                                -- 'pension','property','cash','chattels','other'
  description text not null,
  value numeric(14,2) not null,
  valued_on date not null,
  ownership_share numeric(5,4) default 1.0,
  relief_class text,            -- 'BPR_100','BPR_50','APR_100','APR_50',null
  relief_notes text,
  in_estate_for_iht boolean default true
);

-- OPERATIONS ----------------------------------------------------------

create table tasks (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid references entities(id),
  title text not null,
  detail text,
  origin text not null check (origin in ('nudge','manual','advisor')),
  rule_key text,                -- dedupe key for generated tasks
  period_key text,              -- rule_key + period_key + entity = unique live task
  category text,                -- 'filing','payment','planning','data','correspondence'
  priority int default 3,
  due_date date,
  status text default 'open' check (status in ('open','done','snoozed','dismissed')),
  snoozed_until date,
  created_at timestamptz default now(),
  completed_at timestamptz,
  unique (entity_id, rule_key, period_key)
);

create table correspondence (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id),
  tax_type text,
  direction text check (direction in ('inbound','outbound')),
  channel text check (channel in ('letter','email','phone','portal')),
  occurred_on date not null,
  counterparty text, subject text not null, summary text,
  response_due date,
  response_status text default 'none'
    check (response_status in ('none','pending','sent','closed')),
  document_id uuid
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id),
  category text, tax_type text, period_label text,
  storage_path text not null, filename text not null,
  uploaded_at timestamptz default now()
);

create table xero_connections (
  entity_id uuid primary key references entities(id),
  tenant_id text not null, tenant_name text,
  refresh_token text not null, scopes text[],
  last_sync_at timestamptz, sync_status text
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id),
  obligation_id uuid references obligations(id),
  tax_type text not null, amount numeric(14,2) not null,
  paid_on date not null,
  direction text check (direction in ('to_hmrc','from_hmrc')),
  reference text
);
```

**Why one `obligations` table:** the cross-entity dashboard is the point of the portal, and
it is one query. Every tax generates rows by a different rule; consumption is uniform.

**Why `workings` is `not null`:** the assistant explains *your* number, not the general rule
(section 13). That only works if every step is persisted.


**Per-year figures, and a bug worth recording.** Payroll and property figures were originally
held on the durable record — `people[entityId] = [{name, director, pay}]` — so a single
entry applied to every year at once. Entering a person's pay for one year silently set it for
all of them. This is the same error as a rate table without dates, and it is invisible until
you have entered a second year.

The fix separates the two kinds of fact. A person and a property are **durable**: name,
director status, address, joint ownership, share. What they were paid or earned in a given
year is **per year**, in `pay[personId|taxYear]` and `propFigures[propertyId|taxYear]`,
keyed the same way `income` already was.

Payroll keys on the **tax year**, not the accounting period, because the secondary threshold
test, the NIC bands and the Employment Allowance all run 6 April to 5 April whatever the
company's year end. So the PAYE tab carries its own year selector listing the tax years the
accounting period touches — two of them for any year end other than 31 March — defaulting to
whichever holds most of the period. Every consumer was repointed at the year of the thing it
describes rather than today's: the monthly PAYE estimate takes the tax year of the tax month
it covers, the Employment Allowance nudge and Ivor's context take the current year and say
which year they mean.

Three consequences worth keeping:

- `recorded` distinguishes *paid nothing* from *nothing entered yet*. They mean different
  things for the Employment Allowance, and collapsing them would assert a nil return nobody
  made — the same distinction the ledger draws between a declared nil and an unfiled return.
- Removing a person removes them from every year. To record that someone left, leave the
  later years empty. The UI says so at the point of deletion.
- Migration cannot know which year an old figure belonged to. It puts it in the current tax
  year, says on screen that this was a guess, and offers to **move** it to another year
  rather than making the user retype it. Carry-forward copies a year onto the next, so a
  stable payroll is entered once.

### 4.1 The ledger: return, then liability, then payment

This is the correction that shaped v0.7, and it is the part of the model that is easiest to
get wrong and hardest to unpick later.

A first cut of this schema recorded **payments** against a tax type, and worked out what was
outstanding by subtracting them from a **computed** figure. That is backwards. The real
sequence is:

1. **You report.** The return declares the amount. Until it is filed, nothing is charged.
2. **The report charges a liability** — or statute charges one in advance, which is what a
   payment on account and a quarterly instalment are.
3. **A payment is allocated to a named liability.** Anything left over is money on account.
4. **Outstanding is arithmetic:** liability less allocations. It is never a status.

Getting this wrong produces a portal that reports money owing that no return ever declared,
and lets an obligation reach `paid` having never been `filed`. Migration `0003_ledger.sql`
puts the sequence into the schema and enforces it.

```sql
create table tax_returns (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  tax_type text not null check (tax_type in ('CT','VAT','PAYE','SA','CGT')),
  period_key text not null,              -- '2025-26' for SA, period end otherwise
  period_end date not null,
  file_by date not null,
  pay_by date not null,
  status text not null default 'not_started'
    check (status in ('not_started','in_progress','ready_to_file','filed')),
  declared_amount numeric(14,2),         -- authoritative once filed
  filed_on date,
  submission_reference text,
  estimate_amount numeric(14,2),         -- what the engine thought. NEVER charged.
  estimate_source text check (estimate_source in ('engine','xero_derived','hmrc','manual')),
  variance numeric(14,2) generated always as (declared_amount - estimate_amount) stored,
  unique (entity_id, tax_type, period_key),
  -- A filed return declares an amount. Without one it charges nothing, which is
  -- the exact failure this table exists to remove.
  constraint filed_returns_declare_an_amount
    check (status <> 'filed' or (declared_amount is not null and filed_on is not null))
);

create table liabilities (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,
  tax_type text not null,
  period_key text,
  kind text not null check (kind in (
    'return_charge','balancing_payment',           -- charged BY a return
    'payment_on_account','quarterly_instalment',   -- charged by statute, in advance
    'interest','penalty','hmrc_amendment','other')),
  label text not null,
  amount numeric(14,2) not null,
  due_date date not null,
  return_id uuid references tax_returns(id) on delete cascade,
  is_estimated boolean not null default false,
  unique (entity_id, tax_type, period_key, kind, due_date)
);

create table payment_allocations (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references payments(id) on delete cascade,
  liability_id uuid not null references liabilities(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  unique (payment_id, liability_id)
);
```

**Two triggers carry the invariants the schema cannot express as CHECKs:**

- `liabilities_require_a_filed_return` — a `return_charge` or `balancing_payment` must name
  a return, and that return must be `filed` with a `declared_amount`. Conversely a
  `payment_on_account` or `quarterly_instalment` must NOT name one: they arise by statute,
  before any return exists.
- `payment_allocations_within_payment` — you cannot allocate more of a payment than the
  payment was for, and you cannot allocate across entities.

**Three views, because outstanding is never stored:**

- `liability_balances` — each liability with `allocated`, `outstanding`, `is_overdue`.
- `credit_on_account` — money paid over and above any named debt, per entity per tax. This
  is a real position and is reported separately. It is not the same thing as having nothing
  to pay, and it is never netted silently against an unrelated liability.
- `tax_account` — the dashboard's single query: charged, paid, outstanding, overdue, next
  due, credit, last return filed, and returns not filed, per entity per tax.

**Why payments on account are liabilities in their own right.** A POA is legally due whether
or not this year's return exists (TMA 1970 s.59A), computed from the *preceding* year's
declared figure. Modelling it as something a return produces would mean nothing appears as
due until you file, which is the opposite of the truth. The same logic covers CT quarterly
instalments — the money is due long before the CT600 — with the difference that instalments
are charged on an estimate by design and carry `is_estimated`, so nothing presents one as a
declared figure. The balancing payment then falls out of the arithmetic: declared less what
was charged in advance, negative where the advance charges overshot.

**What `obligations` is now.** It remains the calendar: what falls due, when, and under
which statute. It no longer holds the money. `obligations.amount_due` is the derived
estimate that drives forecasting and is explicitly not a debt; `obligations.status` is
calendar state, and for anything that declares or charges, the truth is `tax_returns.status`
and `liability_balances.outstanding`.

**Migrating the old "mark filed" tick.** Earlier builds recorded filing as a boolean against
an obligation key, carrying no amount. Those become `tax_returns` rows with `status='filed'`
and `declared_amount` null, flagged in the UI as *filed — declared amount not recorded*.
They charge nothing, which is honest: the tick never knew what the return said. The portal
prompts for the figure rather than assuming one.

The pure functions implementing all of the above are in `src/lib/tax/ledger.ts`, with 37
tests in `src/lib/tax/__tests__/ledger.test.ts` covering the instalment date arithmetic, the
POA de minimis and deducted-at-source tests, the balancing payment including the repayment
case, allocation ordering, and the money-on-account cases.


---

## 5. Corporate tax modules

All figures verified against GOV.UK and HMRC manuals as at 31 August 2026.

### 5.1 Corporation Tax

- Small profits rate **19%** to the lower limit (£50,000)
- Main rate **25%** above the upper limit (£250,000)
- Between: main rate less Marginal Relief

```
MR = F × (U − A) × (N ÷ A)
F = 3/200 · U = upper limit · A = augmented profits · N = taxable total profits
```

Where no distributions are received `N = A`, collapsing to `(U − A) × 3/200`.

**Limits divide by the number of associated companies** (including the company itself, per
CTM03935) and time-apportion for periods under 12 months.

**Counting, per CTA 2010 s.18E, in this order:**

1. Identify companies under common control at any time in the subject company's AP
2. Disregard any that **carried on no trade or business at any time in that AP** — s.18E(3),
   CTM03940. Non-activity, not dormancy.
3. Disregard qualifying **passive holding companies** — s.18F, CTM03945, the codified SP 5/94.
   Six cumulative conditions; narrow, and failed by a holding company with cash, an
   intra-group loan, or management expenses. Failing s.18F does not make a company an
   associate — you can still argue non-business on *Jowett* principles.
4. Count associated for the **whole** period if associated for **any part** of it — no
   apportionment (s.18E(1)–(2), CTM03956)
5. Divide, then time-apportion for a short AP

Today that gives your trading company its full £50,000/£250,000. The computation stores both
the `association_determination_id` and the `entity_period_activity` rows it relied on, so a
later change of view recomputes cleanly with the audit trail intact.

**Two what-ifs the module must expose**, because they are decisions rather than reports:

- *Trade start date* — pick a hypothetical date for the dormant company and see the effect on
  the trading company's charge for each affected period. This is what makes the trap in
  section 1 actionable.
- *Association view* — flip the determination and see the delta. You are the one making that
  call; the portal's job is to price it.

**Close investment-holding companies:** a close company existing wholly or mainly to hold
investments is a CIHC under CTA 2010 s.34 and is **denied the small profits rate outright** —
25% on all profits, whatever the limits say. So a passive company can be simultaneously
excluded from the associate count and taxed at the main rate itself. Model CIHC status as its
own flag rather than inferring it from the association logic.

- **Payment:** 9 months and 1 day after period end (non-instalment companies)
- **Filing:** CT600 due 12 months after period end
- **QIPs** above £1.5m taxable profits, "very large" above £20m — **both divide by
  associated companies too**. Two associated companies puts the instalment regime at
  £750,000, not £1.5m. Flag it; instalment calculation itself is out of scope for v1.

### 5.2 VAT

- Registration threshold **£90,000** rolling 12-month, or expected to exceed in the next 30
  days; deregistration threshold **£88,000**
- Standard quarterly returns: **1 calendar month and 7 days** after period end, payment same
  day (annual accounting and POA regimes differ)
- Track rolling 12-month turnover for any unregistered entity, warn at 80%

**Constraint:** Xero's API does not expose the UK VAT return — an open developer request
since 2018. So derive the boxes from Journals + TaxRates (gives workings), retrieve the
*filed* return from HMRC's VAT API (gives truth), and show the variance. That variance view
exists nowhere else you have access to.

### 5.3 PAYE and NICs — 2026/27

| Item | Value |
|---|---|
| Personal allowance | £12,570 |
| Basic 20% / higher 40% / additional 45% | to £37,700 / £37,701–£125,140 / above £125,140 |
| NIC LEL · PT · ST · UEL | £6,708 · £12,570 · £5,000 · £50,270 |
| Employee NIC | 8% PT→UEL, 2% above |
| Employer NIC | 15% above ST |
| Employment Allowance | £10,500 |
| Apprenticeship Levy | 0.5% over £3m pay bill, £15,000 allowance |

- **Payment:** 22nd of the following month electronically; quarterly if average monthly
  liability under £1,500
- **RTI:** FPS on or before payday; EPS by the 19th
- **Employment Allowance — correcting an earlier draft of this spec.** I previously wrote
  that a two-director company qualifies. That is too loose, and with your wife as a director
  the precision matters.

  The statute (NICA 2014 s.2(4A)) excludes a company where all earnings payments go to a
  single employed earner who is a director. But **HMRC's operating test counts heads paid
  above the secondary threshold, not directorships** (NIM06545): "the decisive factor is that
  the additional employees must be paid above the Secondary Threshold." Five directors with
  four unpaid and one on £60,000 → not eligible.

  So the test is: **at least two people paid above the annual secondary threshold** (£5,000
  for 2026/27, pro-rated if a directorship began mid-year — directors have an annual earnings
  period, so it is the annual figure that governs, not a weekly one).

  The awkward middle case is a second director paid *something* but below the ST. HMRC say
  not eligible; a literal reading of s.2(4A) is arguably against them, since payments are
  then not all to the same earner. Not a hill worth dying on for £10,500 — **pay the second
  director above £5,000 and the question disappears.** A token sub-threshold salary is the
  worst outcome: real cost, contested claim, HMRC's manual squarely against you.

  Model this as a computed eligibility test over actual pay data, with a nudge (section 9)
  that fires while the year is still open. Changing circumstances mid-year gives the full
  allowance for that whole tax year.

- **Employment Allowance across connected companies: only one claim** (NICA 2014 s.3).
  Companies under your common control are connected on the plain control test, and the
  substantial-commercial-interdependence carve-out does not rescue you where you control both
  directly. Connection is tested **at the beginning of the tax year**, and the companies
  simply decide between themselves which claims — no election is filed, and unused allowance
  is not transferable mid-year, so a wrong choice wastes relief.

  A dormant company with no payroll does not compete for the allowance, because it would not
  qualify in its own right. But a non-trading company *with* a payroll does. This becomes live
  the moment the second company starts trading and takes on staff — another consequence to
  attach to that single event (section 5.4).

### 5.4 The dormant company

A dormant entity generates a *different* obligation set, not an empty one. The obligation
generator branches on `trading_status`, and getting this wrong is how a dormant company gets
struck off.

**Companies House — unchanged by dormancy:**

- **Confirmation statement** annually, within **14 days** of the review period end. Failure is
  a criminal offence and the most common trigger for compulsory strike-off. This is the one to
  protect.
- **Dormant accounts on form AA02** — balance sheet and notes only, no P&L, no directors'
  report, audit-exempt under CA 2006 s.480. Due **9 months** after the accounting reference
  date. AA02 is unavailable if the company was non-dormant at any point in the period.
- **Director and PSC identity verification** under ECCTA 2023, mandatory since 18 November
  2025 — dormant companies included, verified at the next confirmation statement.
- Watch what breaks dormancy: CA 2006 s.1169 disregards subscriber shares, registrar fees and
  late-filing penalties, but **any other payment from the company account is a significant
  transaction** — an accountant's fee or a bank charge ends dormancy for Companies House
  purposes. (Note this does *not* automatically make it an associated company; that is the
  s.18E trade-or-business test, which bank charges alone would not meet.)

**HMRC:**

- No CT600 is required where HMRC has accepted the company as dormant and issued no notice to
  deliver. But **if a notice has been issued, a return must be filed regardless** — file nil
  and ask HMRC to set the record dormant so future notices stop.
- **Starting to trade: notify HMRC in writing within 3 months of the start of the accounting
  period** (FA 2004 s.55) — the clock runs from the period start, not the year end, and it is
  short. Separately, Sch 18 FA 1998 para 2 requires notification of chargeability within 12
  months of the AP end where no notice was received.

**Note the double effect when the dormant company starts trading:** the s.55 notification
clock starts *and* the trading company's limits halve for its whole current period. One event,
two consequences, and the portal should raise both as a single linked task.

**Coming in April 2028:** Companies House moves to iXBRL filing via commercial software only,
small companies and micro-entities must file a P&L, and audit-exemption and dormant claims
need a strengthened eligibility statement. Worth a forward-dated note.

---

## 6. Personal tax modules — 2026/27

### 6.1 Income tax and the rate split coming in 2027/28

| Item | 2026/27 |
|---|---|
| Personal allowance | £12,570, tapered £1 per £2 over £100,000, gone at £125,140 |
| Bands | 20% to £37,700 · 40% to £125,140 · 45% above |
| Threshold freeze | extended to **5 April 2031** |
| Dividend allowance | £500 |
| Dividend rates | **10.75% / 35.75% / 39.35%** |
| Personal savings allowance | £1,000 basic · £500 higher · nil additional |
| Starting rate for savings | £5,000 at 0%, withdrawn £1-for-£1 by non-savings income above the PA, nil at £17,570 |
| ISA allowance | £20,000 (Junior £9,000) |
| HICBC | starts £60,000, full clawback £80,000, 1% per £200 |

**Two things to build for now rather than retrofit:**

**Dividend rates rose 2pp on 6 April 2026.** Ordinary 8.75%→10.75%, upper 33.75%→35.75%.
That is a live change to your extraction arithmetic this tax year, and the portal should
model salary/dividend extraction against the current numbers rather than remembered ones.

**From 6 April 2027 property and savings income each get their own +2pp rate set** (22/42/47).
So from 2027/28 there are **four** rate tables — non-savings, property, savings, dividends —
not one with a dividend annex. Build the four-way split into `tax_rates` and the calculation
engine from the start; retrofitting it is far more expensive.

### 6.2 Household extraction planning

With both of you directors and shareholders, extraction is a **two-person optimisation**, and
that is the single most-used screen the personal module will have. Inputs: each person's
shareholding, other income, and allowances. Output: the salary and dividend combination that
minimises total household tax, with the constraints made explicit rather than assumed.

Constraints the optimiser must respect:

- **Employment Allowance eligibility** (section 5.3) — the £5,000-per-head secondary
  threshold floor is a *reason to pay* the second director, and the optimiser should show the
  £10,500 as part of the answer rather than treating salary purely as a cost
- **Dividends follow actual beneficial entitlement.** Close company shares are Exception D
  under ITA 2007 s.836(3) — the 50/50 rule never applies, no Form 17 is needed or accepted,
  and each of you is taxed on your real percentage. That makes the shareholding split itself
  the planning lever.
- **The £100,000 personal allowance taper** — the 60% effective band between £100,000 and
  £125,140, per person
- **HICBC** between £60,000 and £80,000 of adjusted net income on the higher earner
- **Pension contributions and Gift Aid reduce adjusted net income**, so they interact with
  both of the above; the optimiser should treat employer pension contributions as an
  extraction route, not just a deduction
- Dividend rates rose 2pp this year (10.75/35.75), which changes last year's answer

**Settlements legislation is the guardrail on the shareholding split.** The outright gift
exemption (ITTOIA 2005 s.626), as construed in *Jones v Garnett* [2007] UKHL 35, protects a
transfer of **ordinary shares carrying full rights** — votes, full dividend rights, and rights
to capital on a winding up — given unconditionally with no reversion or benefit back. What
falls outside it, and gets the income taxed back on the transferor under s.624:

- Shares stripped of voting rights *and* winding-up rights — "wholly or substantially a right
  to income" (TSEM4205, Example 5)
- A bespoke class created purely to route dividends
- **Dividend waivers** — no property transferred, so the spousal exemption cannot apply at
  all (TSEM4220); HMRC's risk markers are insufficient reserves to pay the same dividend
  across all shares, and repeated waivers
- Unequal dividends on shares of the same class
- Any gift subject to conditions, reversion, or a shareholders' agreement requiring transfer
  back

So the portal stores the **rights attaching to each holding**, not just the percentage
(`officers_and_holdings.full_ordinary_rights`), and flags a holding that would not survive
the s.626 test before it is relied on for a dividend split.

### 6.3 Property

- Property allowance £1,000 gross; rent-a-room £7,500 (£3,750 if shared)
- **Jointly held property and Form 17.** Property held in joint names by a married couple
  living together is taxed **50/50 regardless of actual beneficial ownership** (ITA 2007
  s.836). A Form 17 declaration (s.837) overrides that to actual entitlement, but only if the
  interests really are unequal and the declaration states the true position — you cannot pick
  a split, and the income share must follow the capital share, so the beneficial ownership
  changes first by deed of trust, with a joint tenancy severed into a tenancy in common.
  **The declaration must reach HMRC within 60 days of its date, and there is no power to
  extend** (TSEM9862). It takes effect from the declaration date, not the start of the tax
  year. That is a hard, unrecoverable deadline and it belongs in the tracker as its own
  obligation type the moment a deed is executed.
- **Jointly held shares in a close company are Exception D** (s.836(3), TSEM9822) — the 50/50
  rule never applies, so each spouse is automatically taxed on actual entitlement. No Form 17
  needed or accepted. That makes company shares a far more flexible planning instrument than
  jointly held property, subject to the settlements legislation: a transfer must be an
  outright gift of the whole beneficial interest, not a right to income (*Jones v Garnett*
  [2007] UKHL 35; ITTOIA 2005 s.626).
- **s.24 finance cost restriction:** no deduction for residential finance costs; a basic
  rate (20%) tax reducer on the lowest of finance costs, property profits, and adjusted
  total income. Unrelieved amounts carry forward. Note the widening gap from April 2027 —
  property income taxed at 22/42/47 while interest is relieved at 20%.
- **FHL regime abolished** from 6 April 2025 (IT/CGT) and 1 April 2025 (CT). Former FHLs
  fold into the ordinary property business. Four things went: unrestricted finance cost
  relief, capital allowances on new expenditure, CGT reliefs (roll-over, BADR, gift relief),
  and FHL profits counting as relevant UK earnings for pension relief. **Directly relevant
  to the Betws-y-Coed holiday letting plan** — if that income lands personally rather than
  in a company, this is the regime it falls into.

### 6.4 Pensions

| Item | 2026/27 |
|---|---|
| Annual allowance | £60,000 |
| MPAA | £10,000 |
| Taper | threshold income £200,000 **and** adjusted income £260,000; £1 per £2; floor £10,000 at £360,000 |
| Carry forward | previous three years, oldest first, membership required in each |
| Lump sum allowance | £268,275 |
| Lump sum & death benefit allowance | £1,073,100 |

The threshold income test is the gateway — under £200,000 and no taper applies whatever
adjusted income is. Carry-forward expiry is a nudge (section 9): unused 2023/24 allowance
dies on 5 April 2027.

### 6.5 Capital gains

| Item | 2026/27 |
|---|---|
| Rates | **18% / 24%** — residential and non-residential now identical |
| Annual exempt amount | £3,000 |
| BADR | **18%**, £1m lifetime limit |
| Investors' Relief | 18%, £1m lifetime limit |

**Rate history matters for disposal-date logic:** main rates rose 10/20 → 18/24 on 30 October
2024, converging with residential. BADR ran 10% → 14% (6 April 2025) → **18% (6 April 2026)**.
The engine must select rates by disposal date, not by current year.

**BADR is per person, and your wife's £1m is a separate £1m** — but only if she satisfies
every condition **in her own right, throughout a full 2 years** (TCGA 1992 s.169I(6),
s.169S(3)):

- ≥5% of ordinary share capital, **and** ≥5% of voting rights, **and** the economic interest
  test — ≥5% of distributable profits and of assets on a winding up, or ≥5% of proceeds on a
  hypothetical sale of the whole ordinary share capital
- Officer or employee of the company throughout. A directorship satisfies this; there is no
  minimum-hours test, but a gap breaks the period.
- Company is a trading company throughout — HMRC's ~20% "substantial" non-trading test

**Transferring shares to a spouse shortly before a sale achieves nothing — the two-year clock
runs on her, not on the shares.** That makes this a monitoring problem, not a transaction
problem, which is exactly what the portal is for: track each person's qualification status
per company continuously, show the date each condition was first met, and flag anyone
*approaching* qualification or at risk of breaking it. At 18% against a 24% main rate the
relief is worth up to £60,000 per person on a £1m gain.

**Inter-spouse transfers before a disposal** are the other lever: no gain, no loss under
s.58, so a transfer ahead of a sale can use both annual exempt amounts and both basic rate
bands. The CGT module should model that alongside the BADR position rather than leaving you
to notice it.

**60-day reporting** for UK residential property disposals runs separately from Self
Assessment — that is its own obligation row (`CGT_60DAY`), and it is the deadline people miss.

### 6.6 Self Assessment and penalties

- Filing 31 January; payments on account 31 January and 31 July at 50% of prior year unless
  under £1,000 or 80%+ taxed at source; balancing payment 31 January
- **Penalty regime is keyed to the obligation's tax year, not today's date.** Classic SA
  penalties (£100 → daily £10 → 5% or £300 at 6 and 12 months) continue to apply to
  pre-MTD years even after you join MTD. MTD brings points-based late submission (4 points
  = £200) and a different late payment structure. Store `penalty_regime` on the obligation.

---

## 7. Estate planning module

Three children, all lineal descendants, so the RNRB is in play. This module is where a
portal built by an accountant for himself earns its keep, because the value is in the
*ledger* — the seven-year gift history and the evidence behind normal-expenditure claims —
which nobody keeps well without a system.

### 7.1 Modelled as a couple

Your wife is a full `individual` entity in the same `household`, not a field on your record.
Independent taxation means her income tax, CGT and allowances are computed separately — but
the estate position is irreducibly joint, and a solo view of it is close to useless:

- **Transferable NRB and RNRB** are percentages of the first-to-die's unused bands, so the
  model needs both estates and a death order
- **Spouse exemption is unlimited** (IHTA 1984 s.18) and applies while married, ending on
  decree absolute rather than on separation
- **Inter-spouse transfers are no gain, no loss** for CGT (TCGA 1992 s.58) — the transferee
  inherits the base cost. Since 6 April 2023 it applies if the couple were living together at
  *any* point in the tax year, not throughout. This is the mechanism behind using both annual
  exempt amounts and both basic rate bands on a disposal, so the CGT module should offer it
  as a modelled option before a disposal, not as a note after.
- **First-death scenario modelling both ways.** Which spouse dies first changes the answer —
  whose RNRB is tapered by the £2m threshold, whose BPR allowance is used, what transfers. The
  module should run both and show the difference; that comparison is the output that actually
  drives will and ownership decisions.

One restriction to note and then park: where the transferor is a long-term UK resident and
the transferee is not, the spouse exemption is capped at the NRB (IHTA 1984 s.18(2), now
tested on long-term residence rather than domicile since 6 April 2025). Almost certainly not
your position, but the model should carry an LTR flag on each individual rather than assume.

### 7.2 The position

| Item | Amount |
|---|---|
| Nil-rate band | £325,000, frozen to 5 April 2030 |
| Residence nil-rate band | £175,000, frozen to 5 April 2030 |
| RNRB taper | reduced £1 per £2 of estate above **£2m**; gone at £2.35m (£2.7m with a transferred RNRB) |
| Transferable NRB / RNRB | up to £650,000 / £350,000 combined for a couple |
| Death rate | 40%, or **36%** if 10%+ of the baseline net estate passes to charity |

**The interaction to model explicitly:** business assets count toward the £2m RNRB taper
threshold at their **unrelieved** value. So a business-owning estate can lose the entire
RNRB while the business itself is fully relieved. With three children and a main residence,
that is £175,000 of band (£350,000 transferable) at stake on a threshold your company
shareholdings push you across. The portal should show the taper position live as
`estate_assets` values change.

### 7.3 Gifts and the seven-year ledger

Taper relief by years between gift and death:

| Years | Rate | Reduction |
|---|---|---|
| 0–3 | 40% | nil |
| 3–4 | 32% | 20% |
| 4–5 | 24% | 40% |
| 5–6 | 16% | 60% |
| 6–7 | 8% | 80% |
| 7+ | 0% | exempt |

**Implement this correctly — it is the most commonly mis-modelled rule in UK tax.** Taper
relief reduces *the tax payable on the gift*, not the value of the gift, and it only bites
where the gift bears tax in its own right — i.e. exceeds the available NRB after cumulation.
A £300,000 gift five years before death gets **no taper benefit at all**: it falls within
the NRB, no tax arises on it, and it simply absorbs NRB and increases tax on the death
estate. A naive implementation that applies the percentage to the gift value will be wrong
in the common case. Unit test this specifically.

Exemptions to track in `gifts`:

- **Annual £3,000**, carry forward one year only — a nudge on 5 April
- **Small gifts £250** per recipient, unlimited recipients, not combinable with another
  exemption for the same person
- **Wedding**: £5,000 child · £2,500 grandchild · £1,000 other
- **Normal expenditure out of income**: unlimited but needs all three limbs — habitual,
  out of income not capital, and leaving sufficient income to maintain the usual standard
  of living. **This claim is made on IHT403 after death, by your executors, from records
  you kept.** The portal should hold a running income-versus-expenditure schedule as
  contemporaneous evidence. That is arguably the single most valuable thing in this module.
- **Gifts with reservation** — flagged on the gift, because a reserved gift achieves nothing

### 7.4 Business and agricultural property relief — verify before relying

Reform took effect **6 April 2026**, introducing a capped allowance for 100% relief with
50% relief above it, and cutting AIM/unlisted shares to 50% with no allowance.

⚠️ **GOV.UK is currently inconsistent on the allowance amount.** Two policy papers still
state **£1m, non-transferable**; the HMRC internal manual (IHTM25520) and the current
changes page state **£2.5m, transferable between spouses** following a December 2025
uprating. The manual is more likely correct, but the stale pages were touched as recently
as July and August 2026, so this is not a safe number to hard-code from secondary reading.

**Action before Block 9: read Finance Act 2026 Schedule 12 directly and record the
statutory position, with the citation, in `docs/`.** You are better placed than most to do
that, and the difference between £1m and £2.5m of relievable value is not a rounding error
on a business-owning estate. Model the allowance as a dated `tax_rates` row so correcting it
is a data change, not a code change.

Also in scope: the separate trust allowance, the anti-forestalling rule for gifts on or
after 30 October 2024 where death falls on or after 6 April 2026, and anti-fragmentation
across multiple trusts.

**What this means for your shareholdings.** Unquoted trading company shares are relevant
business property at 100% under IHTA 1984 s.105(1)(bb) with **no minimum holding** — 1%
qualifies as readily as control — after **2 years' ownership** (s.106). Both of your holdings
should qualify, subject to two tests the portal should track:

- **Wholly or mainly trading** (s.105(3)) — more than 50%, judged across turnover, profit,
  asset values and time. Note this is materially more generous than BADR's ~20% "substantial"
  test, so a company can fail BADR's trading test and still get BPR.
- **Excepted assets** (s.112) — relief is denied on value attributable to any asset not used
  wholly or mainly for the business throughout the 2 years *and* not required for future
  business use. Surplus cash, an investment portfolio, or a property let to third parties is
  the standard attack point on an owner-managed company. It does not disqualify the shares;
  it proportionately reduces the relieved value. "Required for future use" needs an
  identified, evidenced need — a general intention to reinvest is not enough, which is an
  argument for recording the business case contemporaneously in `documents`.

If the allowance is transferable as the manual states, the old imperative to equalise
shareholdings purely to preserve both allowances is much weakened — unused allowance passes
to the survivor. Equalisation still earns its keep for BADR limits, dividend rate bands and
the 7-year lifetime cycle, but the IHT reason for it may have gone. One more reason to settle
the £1m/£2.5m question from the statute before Block 10.

### 7.5 Pensions into IHT — April 2027

Most unused pension funds and death benefits come within the estate for deaths on or after
**6 April 2027**. Not yet in force. Excluded: death-in-service from registered schemes,
dependants' scheme pensions, and anything to a surviving spouse or charity. Personal
representatives — not scheme administrators — report and pay.

Build the estate model with `estate_assets.in_estate_for_iht` as a **dated rule**, not a
boolean assumption, so pension assets flip into the estate automatically on 6 April 2027 and
you can run both scenarios today.

### 7.6 Deadlines

- IHT due by the **end of the sixth month after the month of death**; interest runs from there
- IHT400 within **12 months** — note the mismatch, tax is due at 6 months on estimates
- Instalment option over **10 years** for land, businesses, controlling holdings and
  qualifying unlisted shares

---

## 8. Deadline engine

Nightly job:

1. Generate forward obligations per entity from accounting period, VAT stagger, PAYE
   frequency, personal tax year, and any 60-day CGT events
2. Overlay HMRC's Obligations API where available — HMRC's view wins, marked `source='hmrc'`
3. Recalculate status; `overdue` the day after `due_date` with no matching payment
4. Recompute CT estimates from the latest Xero trial balance so dashboard figures are never
   more than a day stale

Generation rules are pure functions in `lib/tax/obligations.ts` taking an entity config and
date range. No mocking required to test.

---

## 9. Nudges and the task list

Ivor nudges when required and creates a to-do list, so this is core scope, not a later
block. Two components: a **rules engine** that evaluates nightly, and a **task list** that
is the single place work lives.

### 9.1 Rule categories

**Statutory deadlines** — escalating as the date approaches (T-30, T-14, T-7, T-1, overdue).
Suppressed once the obligation is `filed` or `paid`.

**Data health** — Xero hasn't synced in 48 hours; a VAT period end has passed with no
derived return; a trial balance moved materially after a computation was marked
`ready_to_file`.

**Threshold approach** — rolling VAT turnover at 80% of £90,000; profits approaching the
associated-company-divided QIP threshold; adjusted net income approaching £100,000 (the 60%
band) or £60,000 (HICBC).

**Structural events** — the class specific to your position:

- **Dormant company shows any activity.** A transaction in the dormant company's Xero feed or
  bank account raises an immediate task, because it may have broken the s.18E(3) disregard and
  halved the trading company's limits for the whole current period. Better to investigate a
  bank charge that turns out to be harmless than to discover it at the year end.
- **Trade start planning window.** Where you've flagged an intention to start trading, a
  prompt showing the cost by start date against the trading company's period boundaries.
- **s.55 notification** — 3 months from the start of the accounting period in which a company
  comes within the charge. Short clock, hard consequence.
- **Confirmation statement** for every company, dormant included, 14 days after the review
  period end.
- **Form 17 60-day deadline** — created the moment a deed of trust is recorded, unextendable,
  and unrecoverable if missed (TSEM9862). Escalate this one hardest of all.
- **Employment Allowance eligibility, while the year is still open.** Fires if fewer than two
  people are on track to be paid above the annual secondary threshold in any company with a
  payroll. £10,500 recoverable by a decision taken in February; nothing recoverable by a
  discovery made in June. Also flags the connected-companies choice once more than one
  company has a payroll.
- **BADR qualification clocks.** Per person per company: the date each condition was first
  satisfied, when the two-year period completes, and — more usefully — an alert if a
  condition is about to break (a resignation, a dilution below 5%, a shift in the trading
  mix). Also a positive nudge when someone is approaching qualification, since the answer to
  "can we sell yet" is a date.
- **BPR two-year clock and excepted assets** — a prompt to review surplus cash and non-business
  assets before they quietly erode the relieved value.

**Planning windows** — the class with the most value, and the one nothing else you use will
tell you:

- Pension annual allowance carry-forward from 2023/24 expires 5 April 2027
- IHT annual exemption for the prior year carries forward one year only — use or lose by
  5 April
- ISA and CGT annual exempt amount unused as 5 April approaches
- A PET reaching its 3, 5 and 7-year points — the taper and clearance dates
- Normal-expenditure-out-of-income evidence: prompt to record the year's income and
  expenditure schedule while the figures are to hand, not after death
- Dividend extraction: rates changed this year; prompt a re-model before the year end
- RNRB taper: estate value approaching £2m at unrelieved values

**Correspondence** — a response due date approaching or passed.

**Anomalies** — derived VAT diverging from HMRC's filed figure beyond a tolerance; a
computed CT charge moving more than X% from the prior estimate.

### 9.2 Task mechanics

Each rule emits a candidate with a `rule_key` and `period_key`. The unique constraint on
`(entity_id, rule_key, period_key)` means re-evaluation updates rather than duplicates — the
single most important detail, because a nudge engine that spams is a nudge engine you turn
off within a fortnight.

- **Snooze** to a date; the rule stops emitting until then
- **Dismiss** permanently for that period; never resurrected for the same `period_key`
- **Auto-complete** when the underlying condition clears (obligation filed, allowance used)
- Escalating priority as a due date nears, so ordering is automatic
- Manual tasks live in the same list — one list, or you will keep a second one elsewhere

The assistant can create tasks (`origin='advisor'`), so "remind me to check that before the
year end" during a conversation lands in the list rather than evaporating.

---

## 10. Xero integration

**Auth:** OAuth 2.0, one app, one tenant connection per company. Note the uncertified app
limit — an organisation may connect at most **2 uncertified apps**; Custom Connections
(paid, machine-to-machine, one org each) are the alternative. For your own companies a
single uncertified app is right.

**Rate limits:** 60 calls/minute and 5,000/day per tenant, 5 concurrent, 10,000/minute
app-wide. Watch `X-DayLimit-Remaining`; back off properly on 429.

| Endpoint | Feeds |
|---|---|
| `Reports/TrialBalance` | CT computation |
| `Reports/ProfitAndLoss`, `Reports/BalanceSheet` | Dashboard, provision reconciliation |
| `Journals` (offset cursor) | VAT box derivation, audit trail |
| `TaxRates`, `Accounts` | Box mapping, add-back mapping |
| `Organisation` | Year end, VAT scheme |
| Payroll UK: `PayRuns`, `Payslips`, `Employees` | PAYE/NIC per period |

Not available: the UK VAT return, and RTI submission records.

Write raw responses to a `xero_raw` staging table before transforming. When a figure looks
wrong at 11pm you will want the payload.

---

## 11. HMRC integration (read-only)

Register on the HMRC Developer Hub as an individual developer. Production credentials
require application but **not** recognised software status.

| API | Gives you |
|---|---|
| VAT (MTD) | Obligations, filed returns, liabilities, payments |
| Obligations (MTD) | Filing obligations across income tax sources |
| Self Assessment Accounts (MTD) | Balance, charges, payments |
| Business Details (MTD) | Registered business and property sources |
| Individual Calculations (MTD) | HMRC's own income tax calculation |
| National Insurance | NI record |

**Not available: no Corporation Tax API, no employer PAYE liabilities API.** Those stay
Xero-derived or manual.

Fraud-prevention headers (`Gov-Client-*`) are required even read-only. Build the header
builder once in `lib/hmrc/headers.ts` and test against HMRC's validation endpoint.

---

## 12. Correspondence and documents

Log each HMRC interaction with the deadline it imposes — a letter saying "respond within 30
days" creates an obligation and a task automatically. Attach scan, reply and outcome to one
thread. Open items with a response due appear on the cross-entity dashboard beside filing
deadlines, because operationally they are the same thing: something HMRC is waiting for.

Correspondence has no 24-month window (section 15) — load anything still live.

---

## 13. The assistant

Modelled on Ivor: embedded in the application, answering both **how the application works**
and **the technical subject matter**, and nudging when required.

### 13.1 Three sources, routed

| Domain | Source | Mechanism |
|---|---|---|
| **Process** — "where do I record a normal-expenditure gift?" | `docs/` MDX in the repo | Retrieval |
| **Technical** — "how does the RNRB taper interact with BPR?" | HMRC manuals, GOV.UK, statute | Retrieval |
| **Personal** — "what's my carry-forward position?" | Your live data | Read-only tool calls |

A cheap classifier routes each question; most real ones are mixed and route to two.

### 13.2 Register: you are the accountant

This is the design difference from every consumer tax assistant. The assistant must:

- Cite **statute and HMRC manual references**, not plain-English paraphrase — IHTM14611,
  s.24 ITTOIA, CTA 2010 s.18D. You will check them.
- **Never say "consult your accountant."** Where a position is a judgement call, it sets out
  the test, cites the authority on both sides, and says plainly that the call is yours. It
  does **not** recommend a position. (Changed from v0.6, which had it leaning one way: on a
  facts-and-circumstances question like association or Form 17 a confident steer from the
  tool is worth less than the competing authority laid out, and is harder to argue against
  later.)
- Distinguish *settled law* from *HMRC's stated view* from *a position that has been
  litigated* — the last of these matters and consumer tools flatten it.
- Flag where GOV.UK contradicts itself, as with BPR/APR (section 7.4), rather than picking a
  number silently.

### 13.3 Tools

Read-only, narrow, typed. No SQL generation.

```
get_entity_position(entity_id, tax_type)
get_upcoming_obligations(days, entity_id?)
get_ct_computation(period_id)               full workings
get_association_position(date)              determination, reasoning, divided limits
get_vat_position(entity_id, period?)        derived vs filed, with variance
get_allowance_position(tax_year)            usage, carry forward, expiry
get_estate_position(as_at)                  NRB, RNRB taper, gift ledger, reliefs
get_gift_ledger(from_date?)                 seven-year cumulation
search_correspondence(query, entity_id?)
explain_calculation(computation_id, step)
create_task(title, detail, due_date, entity_id?)
```

`explain_calculation` is the important one. Because `ct_computations.workings` stores every
step, the assistant explains *your* number: "your upper limit is £125,000 because two
companies are associated under the determination effective 1 April 2026, so with augmented
profits of £180,000 marginal relief is (125,000 − 180,000) — negative, so none applies and
the full main rate stands."

### 13.4 Keeping the process corpus honest

Documentation lives as MDX in `web/docs/`, indexed into pgvector **at deploy time from the
deployed commit** — the help corpus cannot describe a version of the app that is not live.
Every screen carries a stable `screen_id`; docs are tagged with the `screen_id`s they cover;
CI fails the build if a screen has no documentation. The advisor panel always knows
`{entity_id, screen_id, selected_period}`, so "what is this number?" resolves against what
is on screen.

### 13.5 Rules

- Process answers cite the doc page; technical answers cite the authority; personal answers
  show the tool call behind each figure
- Figures come **only** from tool calls, never from the corpus or from memory
- Never claims a filing was made — it reports what the portal records
- On no retrieval hit, says so. A process bot that invents a menu path is worse than none.

Log every exchange. As sole user you get a free signal about which parts of your own app are
confusing, and unanswered questions are a docs to-do list.

### 13.6 What is built: Ivor in the single-file portal

The browser build carries a working Ivor. It is the same design one layer down: no server,
no vector index, and the model — where the viewer's environment provides one — never touches
a figure.

**Two grounding sources, and only two.**

1. *The live ledger.* `ivorContext()` walks every entity and, per tax, reports the last
   return filed and what it declared, the next return and its deadline, returns past the
   filing date, charged / paid / outstanding / overdue / credit, and each open charge with
   its due date. Company rows add the association divisor with the divided limits and the
   Employment Allowance position; individual rows add the engine's income tax figure,
   explicitly marked an estimate.
2. *The authority table* (`KB`). ~30 topics, each with a short answer, detail, statutory and
   HMRC manual citations, and — where it matters — a `judgement` field naming the competing
   authority. Topics whose content depends on a rate are written as **functions over the
   engine's own constants**, so the sentence explaining marginal relief and the code
   computing it cannot drift apart. `KB_VERIFIED` dates the table.

**Routing.** A question about the *position* ("what do I owe", "what is overdue") is answered
from the ledger alone and never reaches a model. A question about the *rule* goes to keyword
retrieval over the authority table, with a minimum score below which Ivor says it holds
nothing rather than reaching for the nearest topic — a weak keyword collision producing a
confident answer about the wrong tax is the failure mode that matters here. A question
containing "when", "deadline", "how does", "what is" is a rule question even when it also
contains "due", so "when is the VAT return due?" is not answered with a balance.

**The model layer.** Where `claude.use('sample')` resolves, the deterministic topic card is
rendered first — instantly, from the table — and the model then writes a short reading of the
question above it, given the grounding facts and told it may not introduce any figure, date,
rate or citation absent from them. The topic card and its citations stay on screen as the
source. Where no model resolves, or the viewer declines it, or it rate-limits, the topic card
alone is the answer and Ivor says so.

**The post-check.** Whatever the model writes is scanned for £ amounts, percentages, dates
and statutory or manual references, and anything not present in the grounding facts is listed
under the answer as *not in the grounding facts — check before relying on them*. This is
cheap, it is not clever, and it is the difference between a tool a chartered accountant can
use and one he cannot: an invented threshold that reads plausibly is the single worst thing
this application could do.

**Contextual questions.** Explainable figures across the portal carry a `data-q` handle
(`topic|entityId|periodKey`). Clicking it opens Ivor on that topic **with the live value in
hand** — the association divisor and this period's computed tax for a CT card, the actual
payments on account charged for a Self Assessment year, the Employment Allowance assessment
for this company's payroll. That is what makes "what does this mean?" an answer about your
number rather than an essay.

**The to-do list.** `buildNudges()` output becomes tasks keyed on `category|entity|title`, so
re-evaluation on every render updates a task and never duplicates one. Done, snooze 14 days
and not-applicable persist; an expired snooze returns the task to the live list marked as
such. Manual tasks sit alongside.


**A glossary, checked before the topics.** Added after Ivor answered "what does NIC LEL, PT,
ST and UEL mean?" with the PAYE *payment dates* topic. Two things were wrong and both were
structural rather than a missing sentence:

1. The authority table had no entry for the NIC thresholds at all, even though the engine
   holds every one of them as a constant. A topic index is not a glossary: "what does X mean"
   is a different question from "how does X work", and the table only answered the second.
2. The matcher scored the question on "PAYE" and "NIC" — words that appear in half the table
   and identify nothing — and returned a confident answer about the wrong thing.

`GLOSSARY` is a term index of acronyms and terms of art, matched **exactly** (whole word, no
fuzzy fallback), consulted before topic retrieval, each entry linking to its fuller topic. A
miss falls through to the topics rather than being smeared across them. Retrieval now weights
words by how many topics mention them, so a rare word carries the question and a common one
does not; a question whose distinctive words are all unknown to the table is scored down
rather than being carried by its common ones; and a definitional question that finds neither
a term nor a strong topic says so and lists what the glossary holds. `hmrc` and `tax` are
stopwords — in a UK tax knowledge base they are navigational.

Four further defects surfaced from one sweep of eighteen representative questions, each
worth recording because each is a class rather than an instance: a bare fragment matching a
title (`ANI` against "associated comp**ani**es"); a position question refused as a definition
because it opened "what is" ("what is overdue?"); a term definition pre-empting the topic
when the question asked how something *works* rather than what it *means*; and a topic
winning on a tag word its rival simply had not been given. The sweep is the test — a matcher
is only as good as the range of phrasings it has been run against.

**What it deliberately will not do:** compute a rate from memory, state a deadline the table
does not hold, recommend a position on a judgement call, or claim a filing was made. On a
question outside the table with no model available it lists what it does hold and stops.

---

## 14. Security

RLS on every table keyed on `entity_access`, written on day one — adding your wife later then
costs one row, not a migration. Xero and HMRC tokens encrypted at rest, never client-side.
All third-party calls server-side. Storage buckets private, short-expiry signed URLs. Audit
tables on `ct_computations`, `vat_returns`, `payments`, `gifts` and
`association_determinations` — you will want to know why a number changed.

---

## 15. Historic data: 24 months

Backfill window is **24 months from go-live**, roughly 1 September 2024. Two years of
journals for two companies is a few thousand records — comfortably inside 5,000 calls/day
per tenant. Backfill in a single overnight run per company; don't build a resumable job you
will use twice.

**Partial periods will exist.** A 31 March year end does not get two complete CT periods
inside 24 months — it misses by about five months. Hence
`accounting_periods.completeness`; suppress variance percentages against anything not
`full` rather than showing a comparative that quietly lies.

**HMRC's window is separate.** Where the VAT and SA APIs give you more than 24 months free,
take it. The 24-month rule governs manual entry and Xero derivation only.

**Two exceptions with no window:** correspondence — load anything still live, an open
enquiry from 2023 matters more than a closed one from last month. And **gifts** — the
seven-year cumulation needs at least seven years of history, and normal-expenditure claims
need longer. The gift ledger is not subject to the 24-month rule; load everything you have.

---

## 16. Build plan

| Block | Scope | Effort |
|---|---|---|
| **1** | Scaffold, schema + RLS, auth, entity CRUD, tab shell | ~3 h |
| **2** | `lib/tax/` corporate: CT with association and marginal relief, VAT, PAYE/NIC. Pure functions, full unit tests | ~4 h |
| **3** | Association workspace — determinations, per-period trade-or-business activity, s.18F and CIHC flags, and the two what-ifs (trade start date, association view) | ~3 h |
| **4** | Obligation engine + cross-entity dashboard, manual entry throughout. **Portal is useful from here** | ~4 h |
| **5** | Task list + nudge rules engine (statutory, data health, correspondence) | ~4 h |
| **6** | Correspondence and documents | ~3 h |
| **7** | Xero OAuth, per-entity tenants, 24-month backfill, nightly sync, TB → CT | ~6 h |
| **8** | Xero journals → VAT boxes; Payroll UK → PAYE periods | ~4 h |
| **9** | Personal, both individuals: income sources, four-way rate engine, SA workings, allowances with carry-forward, CGT with disposal-date rate selection, inter-spouse no-gain-no-loss modelling, 60-day obligations, Form 17 tracking | ~8 h |
| **9b** | Household extraction optimiser + officers/holdings model, EA eligibility computation, BADR qualification tracking per person per company | ~4 h |
| **10** | Estate at household level: gift ledgers, beneficiaries, estate assets, NRB/RNRB with taper, transferable bands, first-death scenarios both ways, BPR/APR **after verifying FA 2026 Sch 12**, pension-into-IHT dated rule | ~8 h |
| **11** | Planning nudges — allowance expiry, PET anniversaries, normal-expenditure evidence, extraction re-model | ~3 h |
| **12** | Assistant: `docs/` corpus + build-time indexing, HMRC corpus, router, tools, screen-context panel | ~8 h |
| **13** | HMRC read-only: registration, OAuth, VAT and SA reconciliation views | ~6 h |
| **14** | Polish: PWA for iPad, mobile dashboard, exports, second-user invite | ~4 h |

Blocks 1–6 give a working portal with no integrations. That ordering de-risks the OAuth work
and means an integration problem never blocks the tool being usable.

---

## 17. Open questions

1. **Company details** — names, year ends, VAT registration status, PAYE scheme, director
   counts. Needed for Block 1.
2. **The dormant company's actual activity.** Genuinely no transactions, or a bank account
   earning interest, or occasional fees paid? It changes nothing for s.18E today either way
   (interest alone is not a business, per *Jowett*), but it changes its Companies House
   dormancy status and therefore whether AA02 is available. Block 4's obligation generator
   needs the real answer.
3. **Is there a plan to trade the second company, and when?** If there is any prospect within
   the next couple of years, the trade-start what-if is worth building early rather than at
   Block 3 — the decision may arrive before the tool does.
4. **BPR/APR allowance** — £1m or £2.5m, transferable or not. Needs Finance Act 2026
   Schedule 12 read directly before Block 10 (section 7.4).
5. **Shareholding and pay detail** — her percentage in each company, the share class and
   whether it carries full ordinary rights (votes, dividends, winding-up capital), when she
   acquired it and how, her appointment date, and what each of you is currently paid. This is
   now the highest-value missing input: it determines Employment Allowance eligibility, the
   dividend split, and both BADR clocks.
6. **Her other income** — employment elsewhere, pension, savings, property. Needed for the
   extraction optimiser to mean anything.
7. **Property** — does the Betws-y-Coed / holiday letting income land personally, jointly, or
   in a company? Post-FHL-abolition that choice drives the property module, and if jointly,
   the Form 17 question arises immediately.

---

## Sources

**Corporate**
- [Corporation Tax rates](https://www.gov.uk/corporation-tax-rates) · [Marginal Relief](https://www.gov.uk/guidance/corporation-tax-marginal-relief) · [CTM03925](https://www.gov.uk/hmrc-internal-manuals/company-taxation-manual/ctm03925)
- **Associated companies:** [CTA 2010 s.18E](https://www.legislation.gov.uk/ukpga/2010/4/section/18E) · [CTM03940 definition](https://www.gov.uk/hmrc-internal-manuals/company-taxation-manual/ctm03940) · [CTM03945 s.18F exclusions](https://www.gov.uk/hmrc-internal-manuals/company-taxation-manual/ctm03945) · [CTM03935 division](https://www.gov.uk/hmrc-internal-manuals/company-taxation-manual/ctm03935) · [CTM03956 whole-period rule](https://www.gov.uk/hmrc-internal-manuals/company-taxation-manual/ctm03956) · [CTM03590 trade or business: cases](https://www.gov.uk/hmrc-internal-manuals/company-taxation-manual/ctm03590) · [CTM03592 investment and holding companies](https://www.gov.uk/hmrc-internal-manuals/company-taxation-manual/ctm03592)
- **Dormant:** [Dormant for Corporation Tax](https://www.gov.uk/dormant-company/dormant-for-corporation-tax) · [Dormant for Companies House](https://www.gov.uk/dormant-company/dormant-for-companies-house) · [Trading and non-trading](https://www.gov.uk/guidance/corporation-tax-trading-and-non-trading) · [FA 2004 s.55](https://www.legislation.gov.uk/ukpga/2004/12/section/55) · [CA 2006 s.1169](https://www.legislation.gov.uk/ukpga/2006/46/section/1169) · [Companies House April 2028 changes](https://www.gov.uk/government/news/companies-house-to-bring-in-changes-to-accounts-filing-from-april-2028)
- [Pay Corporation Tax](https://www.gov.uk/pay-corporation-tax) · [Company Tax Return deadlines](https://www.gov.uk/company-tax-returns/deadlines)
- [VAT Return deadlines](https://www.gov.uk/vat-returns/deadlines) · [VAT thresholds](https://www.gov.uk/how-vat-works/vat-thresholds)
- [Rates and thresholds for employers 2026–27](https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027) · [Paying HMRC](https://www.gov.uk/running-payroll/paying-hmrc) · [RTI reporting](https://www.gov.uk/running-payroll/reporting-to-hmrc)
- **Employment Allowance:** [NICA 2014 s.2](https://www.legislation.gov.uk/ukpga/2014/7/section/2) · [s.3 connected companies](https://www.legislation.gov.uk/ukpga/2014/7/section/3) · [NIM06545](https://www.gov.uk/hmrc-internal-manuals/national-insurance-manual/nim06545) · [NIM06590](https://www.gov.uk/hmrc-internal-manuals/national-insurance-manual/nim06590) · [Single director companies guidance](https://www.gov.uk/government/publications/employment-allowance-more-detailed-guidance/single-director-companies-and-employment-allowance-further-employer-guidance) · [Connected companies guidance](https://www.gov.uk/government/publications/employment-allowance-more-detailed-guidance/connected-companies-and-employment-allowance-further-guidance-for-employers-and-their-agents)
- **BADR / BPR / settlements:** [TCGA 1992 s.169I](https://www.legislation.gov.uk/ukpga/1992/12/section/169I) · [CG64050](https://www.gov.uk/hmrc-internal-manuals/capital-gains-manual/cg64050) · [IHTA 1984 s.106](https://www.legislation.gov.uk/ukpga/1984/51/section/106) · [IHTM25261 trading test](https://www.gov.uk/hmrc-internal-manuals/inheritance-tax-manual/ihtm25261) · [IHTM25341 excepted assets](https://www.gov.uk/hmrc-internal-manuals/inheritance-tax-manual/ihtm25341) · [TSEM4205 outright gift exemption](https://www.gov.uk/hmrc-internal-manuals/trusts-settlements-and-estates-manual/tsem4205) · [TSEM4220 dividend waivers](https://www.gov.uk/hmrc-internal-manuals/trusts-settlements-and-estates-manual/tsem4220)

**Personal**
- [Income Tax rates and allowances](https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past) · [Budget 2025 Annex A](https://www.gov.uk/government/publications/budget-2025-overview-of-tax-legislation-and-rates-ootlar/annex-a-rates-and-allowances)
- [Changes to tax rates for property, savings and dividend income](https://www.gov.uk/government/publications/income-tax-changes-to-tax-rates-for-property-savings-and-dividend-income/income-tax-changes-to-tax-rates-for-property-savings-and-dividend-income)
- [Threshold freeze to 5 April 2031](https://www.gov.uk/government/publications/maintaining-income-tax-and-equivalent-national-insurance-contributions-thresholds-until-5-april-2031)
- [CGT rates and annual exempt amount](https://www.gov.uk/government/publications/rates-and-allowances-capital-gains-tax/capital-gains-tax-rates-and-annual-tax-free-allowances) · [BADR](https://www.gov.uk/business-asset-disposal-relief)
- [Tax relief for residential landlords](https://www.gov.uk/guidance/changes-to-tax-relief-for-residential-landlords-how-its-worked-out-including-case-studies) · [FHL abolition](https://www.gov.uk/government/publications/furnished-holiday-lettings-tax-regime-abolition/abolition-of-the-furnished-holiday-lettings-tax-regime)
- [Pension schemes rates](https://www.gov.uk/government/publications/rates-and-allowances-pension-schemes/pension-schemes-rates) · [Annual allowance](https://www.gov.uk/tax-on-your-private-pension/annual-allowance)
- [Self Assessment penalties](https://www.gov.uk/self-assessment-tax-returns/penalties) · [MTD penalties](https://www.gov.uk/guidance/penalties-for-making-tax-digital-for-income-tax) · [MTD thresholds](https://www.gov.uk/guidance/find-out-if-and-when-you-need-to-use-making-tax-digital-for-income-tax)

**Estate**
- [Inheritance Tax](https://www.gov.uk/inheritance-tax) · [Gifts](https://www.gov.uk/inheritance-tax/gifts) · [RNRB](https://www.gov.uk/guidance/inheritance-tax-residence-nil-rate-band)
- [Taper relief — IHTM14611](https://www.gov.uk/hmrc-internal-manuals/inheritance-tax-manual/ihtm14611) · [GWR — IHTM14301](https://www.gov.uk/hmrc-internal-manuals/inheritance-tax-manual/ihtm14301)
- [APR/BPR from 6 April 2026 — IHTM25520](https://www.gov.uk/hmrc-internal-manuals/inheritance-tax-manual/ihtm25520) · [APR/BPR changes](https://www.gov.uk/government/publications/changes-to-agricultural-property-relief-and-business-property-relief/agricultural-property-relief-and-business-property-relief-changes) — **note the conflict in section 7.4**
- [Unused pension funds and death benefits](https://www.gov.uk/government/publications/inheritance-tax-unused-pension-funds-and-death-benefits/inheritance-tax-unused-pension-funds-and-death-benefits)
- **Spouses:** [IHTM11032 spouse exemption](https://www.gov.uk/hmrc-internal-manuals/inheritance-tax-manual/ihtm11032) · [IHTM11033 limited exemption](https://www.gov.uk/hmrc-internal-manuals/inheritance-tax-manual/ihtm11033) · [CG22200 no gain no loss](https://www.gov.uk/hmrc-internal-manuals/capital-gains-manual/cg22200) · [TSEM9842 Form 17](https://www.gov.uk/hmrc-internal-manuals/trusts-settlements-and-estates-manual/tsem9842) · [TSEM9862 the 60-day limit](https://www.gov.uk/hmrc-internal-manuals/trusts-settlements-and-estates-manual/tsem9862) · [TSEM9822 close company shares](https://www.gov.uk/hmrc-internal-manuals/trusts-settlements-and-estates-manual/tsem9822)
- [Paying Inheritance Tax](https://www.gov.uk/paying-inheritance-tax) · [Yearly instalments](https://www.gov.uk/paying-inheritance-tax/yearly-instalments)

**Integrations**
- [HMRC API catalogue](https://api.gov.uk/hmrc/) · [Xero Reports API](https://developer.xero.com/documentation/api/accounting/reports) · [Xero API limits](https://developer.xero.com/faq/limits) · [Xero VAT return API request](https://xero.uservoice.com/forums/5528-xero-accounting-api/suggestions/34455649-create-api-to-get-vat-return)
