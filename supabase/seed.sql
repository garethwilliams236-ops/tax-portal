-- Seed data.
--
-- ⚠️ EVERY VALUE MARKED «TODO» IS A PLACEHOLDER. See PLACEHOLDERS.md for the
-- full register, what each one feeds, and why it matters. Nothing here is a
-- guess at your real position — the placeholders are deliberately obvious so
-- they cannot be mistaken for data.
--
-- What IS real and load-bearing:
--   • two companies, one trading and one dormant, both owned by you
--   • the dormant company carries on no trade or business, so it is disregarded
--     under CTA 2010 s.18E(3) and the trading company keeps full limits
--   • you and your wife are both directors and shareholders of the trading company
--   • three children, all lineal descendants, so the RNRB is in play

begin;

-- ---------------------------------------------------------------------------
-- Household
-- ---------------------------------------------------------------------------

insert into households (id, name, marriage_date) values
  ('00000000-0000-0000-0000-000000000001', 'Williams household', null); -- «TODO P-09: marriage date»

-- ---------------------------------------------------------------------------
-- Individuals
-- ---------------------------------------------------------------------------

insert into entities (id, slug, name, type, household_id, ni_number, date_of_birth, tax_regime) values
  ('00000000-0000-0000-0000-000000000101', 'gareth', 'Gareth Williams', 'individual',
   '00000000-0000-0000-0000-000000000001',
   null,  -- «TODO P-07: NI number»
   null,  -- «TODO P-07: date of birth»
   'rUK'),
  ('00000000-0000-0000-0000-000000000102', 'spouse', '«TODO P-08: wife''s name»', 'individual',
   '00000000-0000-0000-0000-000000000001',
   null,  -- «TODO P-08: NI number»
   null,  -- «TODO P-08: date of birth»
   'rUK');

-- ---------------------------------------------------------------------------
-- Companies
-- ---------------------------------------------------------------------------

insert into entities (
  id, slug, name, type, company_number, utr, vrn, paye_reference,
  accounts_office_reference, year_end_month, year_end_day,
  vat_registered, vat_scheme, vat_stagger, trading_status
) values
  ('00000000-0000-0000-0000-000000000201', 'trading-co',
   '«TODO P-02: trading company name»', 'company',
   null,  -- «TODO P-02: company number»
   null,  -- «TODO P-02: UTR»
   null,  -- «TODO P-02: VRN, if registered»
   null,  -- «TODO P-02: PAYE reference»
   null,  -- «TODO P-02: accounts office reference»
   3, 31, -- «TODO P-02: year end — placeholder 31 March»
   false, -- «TODO P-02: VAT registered?»
   'standard',
   null,  -- «TODO P-02: VAT stagger»
   'trading'),

  ('00000000-0000-0000-0000-000000000202', 'second-co',
   '«TODO P-03: dormant company name»', 'company',
   null,  -- «TODO P-03: company number»
   null,  -- «TODO P-03: UTR»
   null, null, null,
   3, 31, -- «TODO P-03: year end — placeholder 31 March»
   false, null, null,
   'dormant');

-- ---------------------------------------------------------------------------
-- Access. Single user today; the second row is all it takes to add your wife.
-- ---------------------------------------------------------------------------

-- «TODO P-06: replace with your real auth.users id after first sign-in»
-- insert into users (id, display_name) values ('<auth-uid>', 'Gareth Williams');
-- insert into entity_access (user_id, entity_id, role)
--   select '<auth-uid>', id, 'owner' from entities;

-- ---------------------------------------------------------------------------
-- Officers and shareholdings
--
-- ⚠️ THE HIGHEST-VALUE MISSING INPUT. These percentages drive Employment
-- Allowance eligibility, the dividend split, and both BADR two-year clocks.
-- The placeholder 50/50 is NOT a recommendation — it is a visibly fake value.
-- ---------------------------------------------------------------------------

insert into officers_and_holdings (
  individual_entity_id, company_entity_id, is_director, is_employee,
  appointed_on, share_class, ordinary_share_pct, voting_rights_pct,
  distributable_profits_pct, winding_up_assets_pct, full_ordinary_rights,
  acquired_on, acquisition_basis, badr_conditions_met_since, notes
) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000201',
   true, true,
   null,        -- «TODO P-04: appointment date»
   'Ordinary',  -- «TODO P-04: share class»
   50, 50, 50, 50,  -- «TODO P-04: real percentages»
   null,        -- «TODO P-04: do the shares carry FULL ordinary rights? votes + dividends + capital on winding up»
   null,        -- «TODO P-04: acquired on»
   null,        -- «TODO P-04: subscription / spousal_gift / purchase»
   null,        -- «TODO P-04: date ALL BADR conditions were first met — drives the 2-year clock»
   'PLACEHOLDER — see PLACEHOLDERS.md P-04'),

  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000201',
   true, true,
   null,        -- «TODO P-05: appointment date»
   'Ordinary',  -- «TODO P-05: share class»
   50, 50, 50, 50,  -- «TODO P-05: real percentages»
   null,        -- «TODO P-05: FULL ordinary rights? critical for ITTOIA s.626 / Jones v Garnett»
   null,        -- «TODO P-05: acquired on»
   null,        -- «TODO P-05: acquisition basis — if spousal gift, was it outright and unconditional?»
   null,        -- «TODO P-05: BADR conditions met since — her own clock, not the shares'»
   'PLACEHOLDER — see PLACEHOLDERS.md P-05'),

  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000202',
   true, false, null, 'Ordinary', 100, 100, 100, 100, null, null, null, null,
   'PLACEHOLDER — dormant company holding, see PLACEHOLDERS.md P-03');

-- ---------------------------------------------------------------------------
-- Association determination
--
-- This is YOUR judgement, recorded with reasoning. The reasoning below reflects
-- what you have told me: you own both, but the second carries on no trade or
-- business, so it is disregarded under s.18E(3).
-- ---------------------------------------------------------------------------

insert into association_determinations (
  effective_from, effective_to, associated_entity_ids, basis, reasoning, reviewed_by, reviewed_on
) values (
  date '2024-09-01', null,
  array['00000000-0000-0000-0000-000000000201'::uuid,
        '00000000-0000-0000-0000-000000000202'::uuid],
  'common_control',
  'Both companies are under my common control. However the second company has not carried on a '
  || 'trade or business at any time in the relevant accounting periods, so it is DISREGARDED under '
  || 'CTA 2010 s.18E(3) (CTM03940). The statutory test is trade-or-business, not Companies Act '
  || 'dormancy. On that basis the trading company retains the full £50,000 / £250,000 limits. '
  || 'THIS DETERMINATION MUST BE REVISITED THE MOMENT THE SECOND COMPANY BEGINS ANY ACTIVITY — '
  || 's.18E(1) counts association for the WHOLE accounting period with no apportionment (CTM03956).',
  'Gareth Williams',
  current_date
);

-- ---------------------------------------------------------------------------
-- Accounting periods and the s.18E activity record
-- ---------------------------------------------------------------------------

insert into accounting_periods (id, entity_id, start_date, end_date, completeness, status) values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201',
   date '2025-04-01', date '2026-03-31', 'full', 'open'),      -- «TODO P-02: confirm real dates»
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201',
   date '2024-09-01', date '2025-03-31', 'partial', 'closed'); -- inside the 24-month window only

insert into entity_period_activity (
  entity_id, subject_period_id, carried_on_trade_or_business, basis, reasoning
) values
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000301',
   false, 'no_activity',
   '«TODO P-03: confirm — genuinely no transactions, or a bank account earning interest? '
   || 'Either way it is disregarded for s.18E (Jowett), but it changes whether AA02 dormant '
   || 'accounts are available at Companies House.»'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000302',
   false, 'no_activity', '«TODO P-03: as above»');

-- ---------------------------------------------------------------------------
-- Children / beneficiaries — three, all lineal descendants for RNRB
-- ---------------------------------------------------------------------------

insert into beneficiaries (household_id, name, relationship, lineal_descendant, date_of_birth) values
  ('00000000-0000-0000-0000-000000000001', '«TODO P-10: child 1 name»', 'child', true, null),
  ('00000000-0000-0000-0000-000000000001', '«TODO P-10: child 2 name»', 'child', true, null),
  ('00000000-0000-0000-0000-000000000001', '«TODO P-10: child 3 name»', 'child', true, null);

commit;
