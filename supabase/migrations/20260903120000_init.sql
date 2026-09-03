-- ═════════════════════════════════════════════════════════════
--  Campaign Hub — database blueprint.
--
--  HOW TO USE (one time): in your Supabase project, open
--  SQL Editor → New query → paste this whole file → Run.
--
--  THE BIG IDEA: the website's code runs in players' browsers,
--  where anyone can tamper with it. So the site is never the
--  security. These Row Level Security (RLS) rules run INSIDE
--  the database and are the real law:
--    • nobody sees anything unless their signed-in email is on
--      the members list below
--    • only a member with role 'dm' can change quests, maps,
--      campaign sections, the party roster, or the member list
--    • players can add notes/codex entries; private notes are
--      readable by their author alone
-- ═════════════════════════════════════════════════════════════

-- ── The invite list ──────────────────────────────────────────
create table if not exists members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text,
  role text not null default 'player' check (role in ('dm','player')),
  created_at timestamptz not null default now()
);
alter table members enable row level security;

-- Helper: the signed-in user's email, lowercased.
create or replace function my_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt()->>'email',''))
$$;

-- Helpers the policies lean on. "security definer" lets them
-- consult the members table without tripping over its own RLS.
create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where lower(email) = my_email())
$$;

create or replace function is_dm() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where lower(email) = my_email() and role = 'dm')
$$;

create policy "members: members read the roster" on members
  for select to authenticated using (is_member());
create policy "members: dm invites" on members
  for insert to authenticated with check (is_dm());
create policy "members: dm edits" on members
  for update to authenticated using (is_dm()) with check (is_dm());
create policy "members: dm removes" on members
  for delete to authenticated using (is_dm());

-- ⚔️ BOOTSTRAP — the first DM. EDIT THIS EMAIL if it's not the
-- one you'll sign in with (it must match exactly).
insert into members (email, display_name, role)
values ('mitchel.shepherd98@gmail.com', 'The DM', 'dm')
on conflict (email) do nothing;

-- ── Campaign sections (the Home page) ────────────────────────
create table if not exists campaign_sections (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table campaign_sections enable row level security;
create policy "sections: members read" on campaign_sections
  for select to authenticated using (is_member());
create policy "sections: dm writes" on campaign_sections
  for insert to authenticated with check (is_dm());
create policy "sections: dm edits" on campaign_sections
  for update to authenticated using (is_dm()) with check (is_dm());
create policy "sections: dm deletes" on campaign_sections
  for delete to authenticated using (is_dm());

insert into campaign_sections (title, body, sort_order) values
('Welcome, travelers', 'Your DM hasn''t written the campaign details yet. **DM:** click *Edit* to replace this text with your world.', 1);

-- ── Quests + their journal ───────────────────────────────────
create table if not exists quests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null default 'active' check (status in ('active','rumor','completed','failed')),
  giver text default '',
  location text default '',
  reward text default '',
  summary text default '',
  created_at timestamptz not null default now()
);
alter table quests enable row level security;
create policy "quests: members read" on quests
  for select to authenticated using (is_member());
create policy "quests: dm writes" on quests
  for insert to authenticated with check (is_dm());
create policy "quests: dm edits" on quests
  for update to authenticated using (is_dm()) with check (is_dm());
create policy "quests: dm deletes" on quests
  for delete to authenticated using (is_dm());

create table if not exists quest_updates (
  id uuid primary key default gen_random_uuid(),
  quest_id uuid not null references quests(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists quest_updates_quest_idx on quest_updates(quest_id);
alter table quest_updates enable row level security;
create policy "quest journal: members read" on quest_updates
  for select to authenticated using (is_member());
create policy "quest journal: dm writes" on quest_updates
  for insert to authenticated with check (is_dm());
create policy "quest journal: dm deletes" on quest_updates
  for delete to authenticated using (is_dm());

-- ── Notes (players AND dm can write) ─────────────────────────
create table if not exists notes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  session_number int,
  is_private boolean not null default false,
  author_email text not null default my_email(),
  created_at timestamptz not null default now()
);
alter table notes enable row level security;
-- Private notes: even the DM cannot read another author's.
create policy "notes: members read (private = author only)" on notes
  for select to authenticated
  using (is_member() and (not is_private or author_email = my_email()));
create policy "notes: members write as themselves" on notes
  for insert to authenticated
  with check (is_member() and author_email = my_email());
create policy "notes: author edits" on notes
  for update to authenticated
  using (author_email = my_email()) with check (author_email = my_email());
create policy "notes: author or dm deletes" on notes
  for delete to authenticated using (author_email = my_email() or is_dm());

-- ── Codex: people & creatures met, plus pinned intel ─────────
create table if not exists codex_entries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'person' check (kind in ('person','creature','faction','place')),
  status text not null default 'unknown' check (status in ('ally','neutral','unknown','hostile','deceased')),
  first_met text default '',
  description text default '',
  author_email text not null default my_email(),
  created_at timestamptz not null default now()
);
alter table codex_entries enable row level security;
create policy "codex: members read" on codex_entries
  for select to authenticated using (is_member());
create policy "codex: members add as themselves" on codex_entries
  for insert to authenticated
  with check (is_member() and author_email = my_email());
create policy "codex: author or dm edits" on codex_entries
  for update to authenticated
  using (author_email = my_email() or is_dm())
  with check (is_member());
create policy "codex: author or dm deletes" on codex_entries
  for delete to authenticated using (author_email = my_email() or is_dm());

create table if not exists codex_notes (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references codex_entries(id) on delete cascade,
  body text not null,
  author_email text not null default my_email(),
  created_at timestamptz not null default now()
);
create index if not exists codex_notes_entry_idx on codex_notes(entry_id);
alter table codex_notes enable row level security;
create policy "codex intel: members read" on codex_notes
  for select to authenticated using (is_member());
create policy "codex intel: members add as themselves" on codex_notes
  for insert to authenticated
  with check (is_member() and author_email = my_email());
create policy "codex intel: author or dm deletes" on codex_notes
  for delete to authenticated using (author_email = my_email() or is_dm());

-- ── Maps ─────────────────────────────────────────────────────
create table if not exists maps (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null default 'other' check (category in ('world','region','city','battle','other')),
  image_url text default '',
  description text default '',
  created_at timestamptz not null default now()
);
alter table maps enable row level security;
create policy "maps: members read" on maps
  for select to authenticated using (is_member());
create policy "maps: dm writes" on maps
  for insert to authenticated with check (is_dm());
create policy "maps: dm edits" on maps
  for update to authenticated using (is_dm()) with check (is_dm());
create policy "maps: dm deletes" on maps
  for delete to authenticated using (is_dm());

-- ── Party roster (links to D&D Beyond sheets) ────────────────
create table if not exists party_characters (
  id uuid primary key default gen_random_uuid(),
  character_name text not null,
  player_name text default '',
  class_text text default '',
  ddb_url text default '',
  blurb text default '',
  created_at timestamptz not null default now()
);
alter table party_characters enable row level security;
create policy "party: members read" on party_characters
  for select to authenticated using (is_member());
create policy "party: dm writes" on party_characters
  for insert to authenticated with check (is_dm());
create policy "party: dm edits" on party_characters
  for update to authenticated using (is_dm()) with check (is_dm());
create policy "party: dm deletes" on party_characters
  for delete to authenticated using (is_dm());
