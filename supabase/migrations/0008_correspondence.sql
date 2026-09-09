-- Ardent Tax Portal — correspondence and its documents
-- Migration 0008.
--
-- What this is for: the letter from HMRC that says something you will need to
-- prove you acted on, two years later, when nobody remembers the phone call.
--
-- Three decisions worth writing down.
--
-- 1. A correspondence item is OPTIONALLY tied to a tax and a period. Most
--    letters are about something — a CT return for a named year, a VAT
--    assessment for a named quarter — and pinning them means they surface on
--    the screen for that period rather than in a general pile. But some are
--    about nothing in particular (an agent authorisation, a change of
--    address), so both columns are nullable. A nullable foreign key is the
--    right shape here; forcing a period would mean inventing one.
--
-- 2. The FOLLOW-UP is a date and a resolved timestamp, not a status word.
--    "Overdue" is then arithmetic against today, exactly as `outstanding` is
--    arithmetic over the ledger rather than a column somebody has to remember
--    to update. A status column drifts; a date cannot.
--
-- 3. FILES live in Supabase Storage, not in the database, and never in the
--    browser. The row here is the metadata; the object is in a PRIVATE bucket
--    whose policies mirror the entity access rules, and it is reached only
--    through a short-lived signed URL minted server-side. There is no public
--    URL for any of it, and nothing is cached: an HMRC letter is exactly the
--    sort of document that must not survive on a machine that gets lost.

-- ---------------------------------------------------------------------------
-- 1. The correspondence item
-- ---------------------------------------------------------------------------

create table correspondence (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references entities(id) on delete cascade,

  -- When it happened, which is not when it was recorded.
  happened_on date not null,

  -- Who was talking to whom. 'note' is an internal record with no counterparty
  -- — a decision taken, a position to remember — and is deliberately in the
  -- same table, because the note explaining why a letter was answered a
  -- certain way belongs next to the letter.
  direction text not null check (direction in ('from_hmrc', 'to_hmrc', 'note')),

  channel text not null default 'letter'
    check (channel in ('letter', 'phone', 'email', 'online', 'form', 'other')),

  subject text not null,
  body text,

  -- HMRC's own reference on the letter, and the officer or office if named.
  hmrc_reference text,
  contact text,

  -- What it is ABOUT. Both nullable: not every letter is about a period.
  tax_type text check (tax_type in ('CT','VAT','PAYE','SA','CGT','MTD_ITSA','CGT_60DAY','IHT','SDLT','OTHER')),
  period_key text,

  -- The follow-up. A date to act by, and the moment it stopped needing action.
  -- Overdue is (respond_by < today and resolved_at is null) — computed, never
  -- stored, so it cannot go stale.
  respond_by date,
  resolved_at timestamptz,
  resolution text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The two reads this table gets: everything for an entity newest first, and
-- what is still open and due.
create index correspondence_entity_idx on correspondence (entity_id, happened_on desc);
create index correspondence_open_idx on correspondence (entity_id, respond_by)
  where resolved_at is null;
create index correspondence_period_idx on correspondence (entity_id, tax_type, period_key);

alter table correspondence enable row level security;

create policy correspondence_read on correspondence
  for select using (can_read_entity(entity_id));
create policy correspondence_write on correspondence
  for all using (can_write_entity(entity_id))
  with check (can_write_entity(entity_id));

-- ---------------------------------------------------------------------------
-- 2. The documents attached to it
-- ---------------------------------------------------------------------------

create table correspondence_files (
  id uuid primary key default gen_random_uuid(),
  correspondence_id uuid not null references correspondence(id) on delete cascade,

  -- Denormalised from the parent so the storage path and the RLS check can
  -- both be answered without a join. It is set by the server action from the
  -- parent row, never from the request.
  entity_id uuid not null references entities(id) on delete cascade,

  -- The object's key inside the private bucket:
  --   {entity_id}/{correspondence_id}/{file id}
  -- The first segment is what the storage policy tests, so a file cannot be
  -- reached by anyone who cannot read the entity.
  storage_path text not null unique,

  -- The name as it was uploaded, for the download. Kept apart from the storage
  -- path so a file called "../../etc/passwd" is a label, not a location.
  file_name text not null,
  content_type text,
  size_bytes bigint,

  uploaded_at timestamptz not null default now()
);

create index correspondence_files_parent_idx on correspondence_files (correspondence_id);

alter table correspondence_files enable row level security;

create policy correspondence_files_read on correspondence_files
  for select using (can_read_entity(entity_id));
create policy correspondence_files_write on correspondence_files
  for all using (can_write_entity(entity_id))
  with check (can_write_entity(entity_id));

-- ---------------------------------------------------------------------------
-- 3. The bucket
-- ---------------------------------------------------------------------------
--
-- Private. `public = false` means there is no unauthenticated URL for an
-- object in it at all, so the only way in is a signed URL, and this portal
-- mints those server-side with a short expiry.

insert into storage.buckets (id, name, public)
values ('correspondence', 'correspondence', false)
on conflict (id) do nothing;

-- The policies mirror the table's. `storage.foldername(name)` splits the
-- object key on '/', so element 1 is the entity id the file was filed under
-- — which is why the path starts with it.

create policy correspondence_objects_read on storage.objects
  for select using (
    bucket_id = 'correspondence'
    and can_read_entity(((storage.foldername(name))[1])::uuid)
  );

create policy correspondence_objects_insert on storage.objects
  for insert with check (
    bucket_id = 'correspondence'
    and can_write_entity(((storage.foldername(name))[1])::uuid)
  );

create policy correspondence_objects_delete on storage.objects
  for delete using (
    bucket_id = 'correspondence'
    and can_write_entity(((storage.foldername(name))[1])::uuid)
  );

-- ---------------------------------------------------------------------------
-- 4. Keep updated_at honest
-- ---------------------------------------------------------------------------

create or replace function touch_correspondence()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger correspondence_touch
  before update on correspondence
  for each row execute function touch_correspondence();
