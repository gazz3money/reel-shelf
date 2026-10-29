-- Reel Shelf database setup.
-- Paste this whole file into Supabase > SQL Editor > New query, then press Run.
-- Safe to run more than once.

create extension if not exists pgcrypto;

-- Everyone who can sign in (you and your wife) shares one shelf.
create table if not exists public.reels (
  id         uuid primary key default gen_random_uuid(),
  url        text not null unique,
  title      text not null default '',
  creator    text not null default '',
  category   text not null default '',
  seconds    integer check (seconds is null or seconds >= 0),
  date       date not null default current_date,
  notes      text not null default '',
  added_by   uuid default auth.uid() references auth.users on delete set null,
  added_at   timestamptz not null default now()
);

-- The name shown next to reels you saved.
create table if not exists public.members (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  name    text not null
);

-- One secret key per person, used by the iPhone Shortcut.
create table if not exists public.shortcut_keys (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  token      text not null unique check (length(token) >= 24),
  created_at timestamptz not null default now()
);

-- Newer Supabase projects don't open new tables to the app automatically.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.reels, public.members, public.shortcut_keys to authenticated;

alter table public.reels         enable row level security;
alter table public.members       enable row level security;
alter table public.shortcut_keys enable row level security;

drop policy if exists "signed-in people share the shelf" on public.reels;
create policy "signed-in people share the shelf" on public.reels
  for all to authenticated using (true) with check (true);

drop policy if exists "signed-in people see names" on public.members;
create policy "signed-in people see names" on public.members
  for select to authenticated using (true);
drop policy if exists "each person sets their own name" on public.members;
create policy "each person sets their own name" on public.members
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "each person manages their own key" on public.shortcut_keys;
create policy "each person manages their own key" on public.shortcut_keys
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Called by the iPhone Shortcut. Only works with a valid Shortcut key.
create or replace function public.add_reel(key text, link text, category text default '', title text default '')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid;
  clean text;
begin
  select k.user_id into uid from shortcut_keys k where k.token = add_reel.key;
  if uid is null then
    raise exception 'This Shortcut key is not recognized. Make a new one in Reel Shelf > Settings.';
  end if;

  clean := substring(coalesce(add_reel.link, '') from 'https?://[^\s<>"'']+');
  if clean is null then
    raise exception 'No link found in what was shared.';
  end if;
  clean := regexp_replace(clean, '^https?://(m|web|mbasic)\.facebook\.com', 'https://www.facebook.com');
  -- Share and reel links carry only tracking in their query string.
  if clean ~* '^https?://(www\.)?(facebook\.com/(reel|share)/|fb\.watch/)' then
    clean := regexp_replace(clean, '[?#].*$', '');
  end if;

  insert into reels (url, category, title, added_by)
  values (clean, coalesce(trim(add_reel.category), ''), coalesce(trim(add_reel.title), ''), uid)
  on conflict (url) do nothing;

  if found then
    return 'Saved to Reel Shelf';
  end if;
  return 'Already on your shelf';
end;
$$;

revoke all on function public.add_reel(text, text, text, text) from public;
grant execute on function public.add_reel(text, text, text, text) to anon, authenticated;
