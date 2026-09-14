-- ═══════════════════════════════════════════════════════════════
--  User profiles + avatars.
--
--  Every signed-in user has ONE profile row, keyed by their email.
--  A user may read and edit only their OWN profile; campaign-mates
--  may read each other's public bits (display name + avatar) so the
--  party sees who's who. Avatars live in a public-read 'avatars'
--  bucket, foldered by the owner so only they can write their own.
--
--  Passwords, email changes, and password resets are handled by
--  Supabase Auth (bcrypt, JWTs, reset-link emails) — NOT here. This
--  migration only stores profile PROFILE data.
-- ═══════════════════════════════════════════════════════════════

create table if not exists profiles (
  email text primary key default my_email(),
  display_name text,
  avatar_path text,                -- storage path in the 'avatars' bucket
  contact jsonb not null default '{}',   -- optional: {discord, timezone, pronouns, ...}
  updated_at timestamptz not null default now()
);
alter table profiles enable row level security;

-- Read: yourself always; plus anyone you share a campaign with (so the
-- party can see display names + avatars). Never leaks profiles of strangers.
drop policy if exists "profiles: self or campaign-mate reads" on profiles;
create policy "profiles: self or campaign-mate reads" on profiles
  for select to authenticated
  using (
    lower(email) = my_email()
    or exists (
      select 1 from campaign_members me
      join campaign_members them on them.campaign_id = me.campaign_id
      where lower(me.email) = my_email() and lower(them.email) = lower(profiles.email)
    )
  );

-- Write: only your own row, and you can't set it to someone else's email.
drop policy if exists "profiles: self inserts" on profiles;
create policy "profiles: self inserts" on profiles
  for insert to authenticated with check (lower(email) = my_email());
drop policy if exists "profiles: self edits" on profiles;
create policy "profiles: self edits" on profiles
  for update to authenticated
  using (lower(email) = my_email()) with check (lower(email) = my_email());

-- keep updated_at honest
create or replace function profiles_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists profiles_touch on profiles;
create trigger profiles_touch before update on profiles
  for each row execute function profiles_touch();

-- Upsert your own profile in one call (insert-or-update on your email).
create or replace function save_profile(p_display_name text, p_avatar_path text, p_contact jsonb)
returns profiles language plpgsql security definer set search_path = public as $$
declare row profiles;
begin
  insert into profiles (email, display_name, avatar_path, contact)
    values (my_email(), p_display_name, p_avatar_path, coalesce(p_contact, '{}'::jsonb))
  on conflict (email) do update
    set display_name = excluded.display_name,
        avatar_path  = coalesce(excluded.avatar_path, profiles.avatar_path),
        contact      = excluded.contact
  returning * into row;
  return row;
end $$;
revoke execute on function save_profile(text, text, jsonb) from public, anon;
grant execute on function save_profile(text, text, jsonb) to authenticated;

-- ── Avatar storage bucket (public-read so party pages can show them) ──
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;
update storage.buckets
   set file_size_limit = 5242880,   -- 5 MB
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif']
 where id = 'avatars';

-- Anyone may READ an avatar (public bucket); a user may only write/replace/
-- delete files in their OWN folder: avatars/<their-email>/...
drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read" on storage.objects
  for select using (bucket_id = 'avatars');
drop policy if exists "avatars: owner writes own folder" on storage.objects;
create policy "avatars: owner writes own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = my_email());
drop policy if exists "avatars: owner updates own folder" on storage.objects;
create policy "avatars: owner updates own folder" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = my_email());
drop policy if exists "avatars: owner deletes own folder" on storage.objects;
create policy "avatars: owner deletes own folder" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = my_email());
