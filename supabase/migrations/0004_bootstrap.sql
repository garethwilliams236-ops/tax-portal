-- Bootstrap: make a newly authenticated user real, and give them their entities.
-- Without this a fresh sign-in authenticates fine and then sees nothing, because
-- RLS is doing its job and no row grants access.

create table if not exists app_settings (
  id boolean primary key default true check (id),
  owner_user_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

-- Mirror auth.users into public.users on sign-up, and record the FIRST user as
-- the owner. A single-owner tool: the first person through the door owns it,
-- and nobody else can claim it afterwards.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  insert into app_settings (id, owner_user_id)
  values (true, new.id)
  on conflict (id) do nothing;

  -- The owner gets access to every entity that already exists.
  insert into entity_access (user_id, entity_id, role)
  select new.id, e.id, 'owner' from entities e
  where exists (select 1 from app_settings s where s.owner_user_id = new.id)
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Any entity created later is owned by whoever created it, so adding a company
-- through the UI does not silently produce a row you cannot read back.
create or replace function grant_creator_access() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    insert into entity_access (user_id, entity_id, role)
    values (auth.uid(), new.id, 'owner')
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists on_entity_created on entities;
create trigger on_entity_created
  after insert on entities
  for each row execute function grant_creator_access();

alter table app_settings enable row level security;
create policy app_settings_read on app_settings
  for select using (auth.uid() is not null);
