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
  with check (is_dm() or author_email = my_email());
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

-- ── Dice: shared rolls + personal presets ────────────────────
-- (kept in sync with supabase/migrations/20260910100000_dice.sql)
create table if not exists rolls (
  id uuid primary key default gen_random_uuid(),
  roller_email text not null,
  label text not null default '',
  dice jsonb not null,
  modifier int not null default 0,
  total int not null,
  created_at timestamptz not null default now()
);
alter table rolls enable row level security;
create policy "rolls: members read" on rolls
  for select to authenticated using (is_member());
create policy "rolls: dm sweeps the table" on rolls
  for delete to authenticated using (is_dm());

create or replace function roll_dice(p_label text, p_spec jsonb, p_modifier int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d jsonb;
  results int[];
  all_dice jsonb := '[]'::jsonb;
  total int := 0;
  sides int; cnt int; total_count int := 0;
  new_row rolls;
begin
  if not is_member() then raise exception 'Not a member of this party'; end if;
  if p_modifier is null or p_modifier < -99 or p_modifier > 99 then
    raise exception 'Modifier must be between -99 and +99';
  end if;
  if p_spec is null or jsonb_typeof(p_spec) <> 'array' or jsonb_array_length(p_spec) = 0 then
    raise exception 'Nothing to roll';
  end if;
  for d in select * from jsonb_array_elements(p_spec) loop
    sides := (d->>'sides')::int;
    cnt := (d->>'count')::int;
    if sides not in (4,6,8,10,12,20,100) then raise exception 'Unknown die: d%', sides; end if;
    if cnt is null or cnt < 1 then raise exception 'Bad dice count'; end if;
    total_count := total_count + cnt;
    if total_count > 40 then raise exception 'Too many dice (max 40 per roll)'; end if;
    results := array(select 1 + floor(random() * sides)::int from generate_series(1, cnt));
    total := total + (select sum(x)::int from unnest(results) x);
    all_dice := all_dice || jsonb_build_array(
      jsonb_build_object('sides', sides, 'count', cnt, 'results', to_jsonb(results)));
  end loop;
  total := total + p_modifier;
  insert into rolls (roller_email, label, dice, modifier, total)
  values (my_email(), left(coalesce(p_label, ''), 60), all_dice, p_modifier, total)
  returning * into new_row;
  return to_jsonb(new_row);
end $$;
revoke execute on function roll_dice(text, jsonb, int) from public, anon;
grant execute on function roll_dice(text, jsonb, int) to authenticated;

do $$ begin alter publication supabase_realtime add table rolls; exception when duplicate_object then null; end $$;

create table if not exists roll_presets (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null default my_email(),
  name text not null,
  spec jsonb not null,
  modifier int not null default 0,
  created_at timestamptz not null default now()
);
alter table roll_presets enable row level security;
create policy "presets: own reads" on roll_presets
  for select to authenticated using (is_member() and owner_email = my_email());
create policy "presets: own writes" on roll_presets
  for insert to authenticated with check (is_member() and owner_email = my_email());
create policy "presets: own edits" on roll_presets
  for update to authenticated
  using (owner_email = my_email()) with check (owner_email = my_email());
create policy "presets: own deletes" on roll_presets
  for delete to authenticated using (owner_email = my_email());
-- 🧙 Characters: full D&D character sheets built on this site.
--
--  • characters: one row per hero. The `sheet` JSONB holds the
--    player's CHOICES (race, class, scores, picked spells…);
--    the browser recomputes everything derivable on render.
--    Members read the whole party's sheets; you write your own
--    (the DM may also fix up or remove any sheet).
--  • roll_check(): like roll_dice() but for d20 checks with
--    advantage/disadvantage — rolls 2d20 server-side and keeps
--    the right one, so "lucky" rolls stay honest. Results land
--    in the same `rolls` feed everyone watches live.

create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null default my_email(),
  name text not null default 'Unnamed hero',
  sheet jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table characters enable row level security;

create policy "characters: members read" on characters
  for select to authenticated using (is_member());
create policy "characters: members write their own" on characters
  for insert to authenticated
  with check (is_member() and owner_email = my_email());
create policy "characters: owner or dm edits" on characters
  for update to authenticated
  using (owner_email = my_email() or is_dm())
  with check (is_dm() or owner_email = my_email());
create policy "characters: owner or dm deletes" on characters
  for delete to authenticated using (owner_email = my_email() or is_dm());

-- keep updated_at honest without trusting the browser
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists characters_touch on characters;
create trigger characters_touch before update on characters
  for each row execute function touch_updated_at();

-- ── d20 checks with advantage / disadvantage ─────────────────
-- p_mode: 'normal' (1d20) | 'adv' | 'dis' (2d20, keep high/low).
-- total = kept die + modifier. Recorded in `rolls` like any roll;
-- the "keep" key tells the dice page which die counted.
create or replace function roll_check(p_label text, p_modifier int, p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r1 int; r2 int; kept int;
  dice_json jsonb;
  new_row rolls;
begin
  if not is_member() then raise exception 'Not a member of this party'; end if;
  if p_modifier is null or p_modifier < -99 or p_modifier > 99 then
    raise exception 'Modifier must be between -99 and +99';
  end if;
  if p_mode not in ('normal','adv','dis') then raise exception 'Bad roll mode'; end if;

  r1 := 1 + floor(random() * 20)::int;
  if p_mode = 'normal' then
    kept := r1;
    dice_json := jsonb_build_array(jsonb_build_object(
      'sides', 20, 'count', 1, 'results', jsonb_build_array(r1)));
  else
    r2 := 1 + floor(random() * 20)::int;
    kept := case when p_mode = 'adv' then greatest(r1, r2) else least(r1, r2) end;
    dice_json := jsonb_build_array(jsonb_build_object(
      'sides', 20, 'count', 2, 'results', jsonb_build_array(r1, r2),
      'keep', case when p_mode = 'adv' then 'high' else 'low' end));
  end if;

  insert into rolls (roller_email, label, dice, modifier, total)
  values (my_email(), left(coalesce(p_label, ''), 60), dice_json, p_modifier, kept + p_modifier)
  returning * into new_row;
  return to_jsonb(new_row);
end $$;

revoke execute on function roll_check(text, int, text) from public, anon;
grant execute on function roll_check(text, int, text) to authenticated;
-- ⚔️ The battle map (VTT): encounters + tokens, synced live.
--
--  • encounters: a battle the DM sets up — which uploaded map,
--    grid settings, and whether it's the ACTIVE one everyone sees.
--  • tokens: what stands on the map. PCs link to a character row,
--    monsters to an SRD bestiary index (or neither = a marker).
--    Position/HP/conditions live here so every open page agrees.
--
--  Law of the table (RLS):
--    - members see everything except tokens the DM keeps hidden;
--    - only the DM creates encounters and adds/removes tokens;
--    - a player may UPDATE a token only if it's a PC token bound
--      to a character THEY own (that's how they move their hero);
--    - the DM updates anything (conditions, monster HP, hiding…).
--  Spell-effect animations are broadcast over a realtime channel
--  and never stored — nothing to secure at rest.

create table if not exists encounters (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Encounter',
  map_id uuid references maps(id) on delete set null,
  grid jsonb not null default '{"cell": 70, "feet": 5, "show": true}',
  active boolean not null default false,
  turn uuid,                            -- token whose initiative turn it is
  created_at timestamptz not null default now()
);
alter table encounters enable row level security;
create policy "encounters: members read" on encounters
  for select to authenticated using (is_member());
create policy "encounters: dm creates" on encounters
  for insert to authenticated with check (is_dm());
create policy "encounters: dm edits" on encounters
  for update to authenticated using (is_dm()) with check (is_dm());
create policy "encounters: dm deletes" on encounters
  for delete to authenticated using (is_dm());

create table if not exists tokens (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references encounters(id) on delete cascade,
  kind text not null default 'marker' check (kind in ('pc','monster','marker')),
  character_id uuid references characters(id) on delete cascade,
  monster_index text not null default '',
  label text not null default '',
  x real not null default 2,
  y real not null default 2,
  size int not null default 1,          -- squares per side (1=M, 2=L, 3=H, 4=G)
  color text not null default '',
  hp_current int,
  hp_max int,
  conditions jsonb not null default '[]',
  hidden boolean not null default false, -- staged by the DM, invisible to players
  initiative int,
  created_at timestamptz not null default now()
);
create index if not exists tokens_encounter_idx on tokens(encounter_id);
alter table tokens enable row level security;

-- May the signed-in player steer this token? (their own PC's)
create or replace function owns_token_character(t_character_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from characters c
    where c.id = t_character_id and lower(c.owner_email) = my_email()
  )
$$;

create policy "tokens: members see (unless hidden)" on tokens
  for select to authenticated using (is_member() and (not hidden or is_dm()));
create policy "tokens: dm places" on tokens
  for insert to authenticated with check (is_dm());
create policy "tokens: dm or the pc's player updates" on tokens
  for update to authenticated
  using (is_dm() or (kind = 'pc' and owns_token_character(character_id)))
  with check (is_dm() or (kind = 'pc' and owns_token_character(character_id)));
create policy "tokens: dm removes" on tokens
  for delete to authenticated using (is_dm());

-- A player may MOVE their own PC token but not restat it: pin which columns
-- a non-DM may change to position + initiative + conditions.
create or replace function guard_token_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_dm() then return new; end if;
  if new.encounter_id is distinct from old.encounter_id
     or new.kind is distinct from old.kind
     or new.character_id is distinct from old.character_id
     or new.monster_index is distinct from old.monster_index
     or new.label is distinct from old.label
     or new.size is distinct from old.size
     or new.color is distinct from old.color
     or new.hp_max is distinct from old.hp_max
     or new.hidden is distinct from old.hidden then
    raise exception 'Players may only move their own token, not restat it';
  end if;
  return new;
end $$;
drop trigger if exists tokens_guard_update on tokens;
create trigger tokens_guard_update before update on tokens
  for each row execute function guard_token_update();

-- live sync for every open battle map
do $$ begin alter publication supabase_realtime add table encounters; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table tokens; exception when duplicate_object then null; end $$;

-- ═══ Multi-campaign (mirrored from migrations/20260914120000_multicampaign.sql) ═══
-- ═════════════════════════════════════════════════════════════
--  Multi-campaign: turn the site into a place where many DMs each
--  run their own campaigns, invite their own players, and NEVER
--  see each other's maps, quests, notes, tokens, or dice.
--
--  Model:
--   • campaigns          — one row per campaign, owned by its DM.
--   • campaign_members    — who belongs to each campaign (dm/player).
--   • campaign_characters — links a player's PORTABLE character into
--     a campaign they've joined (characters belong to the player and
--     can be brought into any campaign, D&D-Beyond style).
--   • every piece of campaign content carries a campaign_id, and
--     the security rules below only ever let you see or change rows
--     in a campaign you belong to.
--
--  Safe to run more than once. Existing content is migrated into a
--  first campaign owned by the current DM — nothing is lost.
-- ═════════════════════════════════════════════════════════════

-- ── campaigns ────────────────────────────────────────────────
create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'New Campaign',
  tagline text,
  owner_email text not null default my_email(),
  created_at timestamptz not null default now()
);
alter table campaigns enable row level security;

create table if not exists campaign_members (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  email text not null,
  role text not null default 'player' check (role in ('dm','player')),
  display_name text,
  created_at timestamptz not null default now()
);
create unique index if not exists campaign_members_unique on campaign_members(campaign_id, lower(email));
create index if not exists campaign_members_email_idx on campaign_members(lower(email));
alter table campaign_members enable row level security;

create table if not exists campaign_characters (
  campaign_id uuid not null references campaigns(id) on delete cascade,
  character_id uuid not null references characters(id) on delete cascade,
  added_by text not null default my_email(),
  created_at timestamptz not null default now(),
  primary key (campaign_id, character_id)
);
alter table campaign_characters enable row level security;

-- ── campaign-scoped authorization helpers ────────────────────
-- SECURITY DEFINER + fixed search_path so they can consult the
-- membership table without tripping its own RLS (and without the
-- recursion that would cause).
create or replace function my_campaign_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select campaign_id from campaign_members where lower(email) = my_email()
$$;

create or replace function is_campaign_member(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from campaign_members
    where campaign_id = cid and lower(email) = my_email()
  )
$$;

create or replace function is_campaign_dm(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from campaign_members
    where campaign_id = cid and lower(email) = my_email() and role = 'dm'
  )
$$;

-- ── campaigns / members / character-links policies ───────────
drop policy if exists "campaigns: members + owner read" on campaigns;
create policy "campaigns: members + owner read" on campaigns
  for select to authenticated using (owner_email = my_email() or is_campaign_member(id));
drop policy if exists "campaigns: anyone signed-in creates (as themselves)" on campaigns;
create policy "campaigns: anyone signed-in creates (as themselves)" on campaigns
  for insert to authenticated with check (owner_email = my_email());
drop policy if exists "campaigns: owner edits" on campaigns;
create policy "campaigns: owner edits" on campaigns
  for update to authenticated using (owner_email = my_email()) with check (owner_email = my_email());
drop policy if exists "campaigns: owner deletes" on campaigns;
create policy "campaigns: owner deletes" on campaigns
  for delete to authenticated using (owner_email = my_email());

drop policy if exists "campaign members: members read roster" on campaign_members;
create policy "campaign members: members read roster" on campaign_members
  for select to authenticated using (is_campaign_member(campaign_id));
drop policy if exists "campaign members: dm invites" on campaign_members;
create policy "campaign members: dm invites" on campaign_members
  for insert to authenticated with check (is_campaign_dm(campaign_id));
drop policy if exists "campaign members: dm edits" on campaign_members;
create policy "campaign members: dm edits" on campaign_members
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
drop policy if exists "campaign members: dm or self removes" on campaign_members;
create policy "campaign members: dm or self removes" on campaign_members
  for delete to authenticated using (is_campaign_dm(campaign_id) or lower(email) = my_email());

drop policy if exists "campaign chars: members read" on campaign_characters;
create policy "campaign chars: members read" on campaign_characters
  for select to authenticated using (is_campaign_member(campaign_id));
drop policy if exists "campaign chars: player adds own or dm adds" on campaign_characters;
create policy "campaign chars: player adds own or dm adds" on campaign_characters
  for insert to authenticated with check (
    is_campaign_member(campaign_id)
    and (is_campaign_dm(campaign_id) or exists (
      select 1 from characters c where c.id = character_id and lower(c.owner_email) = my_email()
    ))
  );
drop policy if exists "campaign chars: owner or dm removes" on campaign_characters;
create policy "campaign chars: owner or dm removes" on campaign_characters
  for delete to authenticated using (
    is_campaign_dm(campaign_id) or exists (
      select 1 from characters c where c.id = character_id and lower(c.owner_email) = my_email()
    )
  );

-- create a campaign and enroll its creator as DM in one shot.
create or replace function create_campaign(p_name text) returns campaigns
language plpgsql security definer set search_path = public as $$
declare c campaigns;
begin
  if my_email() = '' then raise exception 'Must be signed in'; end if;
  insert into campaigns (name, owner_email) values (coalesce(nullif(p_name,''),'New Campaign'), my_email())
    returning * into c;
  insert into campaign_members (campaign_id, email, role, display_name)
    values (c.id, my_email(), 'dm', null)
    on conflict do nothing;
  return c;
end $$;
revoke execute on function create_campaign(text) from public, anon;
grant execute on function create_campaign(text) to authenticated;

-- ── add campaign_id to every content table ───────────────────
alter table campaign_sections add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table quests           add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table quest_updates    add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table notes            add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table codex_entries    add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table codex_notes      add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table maps             add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table party_characters add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table rolls            add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table roll_presets     add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table encounters       add column if not exists campaign_id uuid references campaigns(id) on delete cascade;
alter table tokens           add column if not exists campaign_id uuid references campaigns(id) on delete cascade;

-- ── migrate existing data into a first campaign ──────────────
-- Picks the current DM (from the old single-campaign members list)
-- as owner, copies the roster in, and stamps all existing content.
do $$
declare def uuid; dm text;
begin
  -- only if there is legacy content/members to migrate and nothing stamped yet
  if not exists (select 1 from information_schema.tables where table_name='members') then return; end if;
  select lower(email) into dm from members where role='dm' order by created_at limit 1;
  if dm is null then select lower(email) into dm from members order by created_at limit 1; end if;
  if dm is null then return; end if;

  select id into def from campaigns where owner_email = dm order by created_at limit 1;
  if def is null then
    insert into campaigns (name, owner_email) values ('My Campaign', dm) returning id into def;
  end if;

  insert into campaign_members (campaign_id, email, role, display_name)
    select def, lower(email), role, display_name from members
    on conflict (campaign_id, lower(email)) do nothing;

  update campaign_sections set campaign_id = def where campaign_id is null;
  update quests            set campaign_id = def where campaign_id is null;
  update quest_updates     set campaign_id = def where campaign_id is null;
  update notes             set campaign_id = def where campaign_id is null;
  update codex_entries     set campaign_id = def where campaign_id is null;
  update codex_notes       set campaign_id = def where campaign_id is null;
  update maps              set campaign_id = def where campaign_id is null;
  update party_characters  set campaign_id = def where campaign_id is null;
  update rolls             set campaign_id = def where campaign_id is null;
  update roll_presets      set campaign_id = def where campaign_id is null;
  update encounters        set campaign_id = def where campaign_id is null;
  update tokens            set campaign_id = def where campaign_id is null;

  -- link every existing character into the default campaign (portable)
  insert into campaign_characters (campaign_id, character_id, added_by)
    select def, id, lower(owner_email) from characters
    on conflict do nothing;
end $$;

-- ── enforce campaign_id going forward ────────────────────────
-- (safe: the backfill above stamped every existing row; new rows
-- always carry a campaign_id from the app + the policies below.)
do $$
declare t text;
begin
  foreach t in array array['campaign_sections','quests','quest_updates','notes','codex_entries','codex_notes','maps','party_characters','rolls','roll_presets','encounters','tokens']
  loop
    if not exists (select 1 from information_schema.columns
                   where table_name = t and column_name='campaign_id' and is_nullable='NO') then
      -- only set NOT NULL if there are no null rows (a fresh install has none)
      execute format('select 1 from %I where campaign_id is null limit 1', t);
      if not found then execute format('alter table %I alter column campaign_id set not null', t); end if;
    end if;
  end loop;
end $$;

create index if not exists campaign_sections_camp_idx on campaign_sections(campaign_id);
create index if not exists quests_camp_idx on quests(campaign_id);
create index if not exists notes_camp_idx on notes(campaign_id);
create index if not exists codex_entries_camp_idx on codex_entries(campaign_id);
create index if not exists maps_camp_idx on maps(campaign_id);
create index if not exists rolls_camp_idx on rolls(campaign_id);
create index if not exists encounters_camp_idx on encounters(campaign_id);
create index if not exists tokens_camp_idx on tokens(campaign_id);

-- ═══ replace every global policy with a campaign-scoped one ═══

-- campaign_sections (DM-owned)
drop policy if exists "sections: members read" on campaign_sections;
drop policy if exists "sections: dm writes" on campaign_sections;
drop policy if exists "sections: dm edits" on campaign_sections;
drop policy if exists "sections: dm deletes" on campaign_sections;
create policy "sections: members read" on campaign_sections
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "sections: dm writes" on campaign_sections
  for insert to authenticated with check (is_campaign_dm(campaign_id));
create policy "sections: dm edits" on campaign_sections
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
create policy "sections: dm deletes" on campaign_sections
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- quests (DM-owned)
drop policy if exists "quests: members read" on quests;
drop policy if exists "quests: dm writes" on quests;
drop policy if exists "quests: dm edits" on quests;
drop policy if exists "quests: dm deletes" on quests;
create policy "quests: members read" on quests
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "quests: dm writes" on quests
  for insert to authenticated with check (is_campaign_dm(campaign_id));
create policy "quests: dm edits" on quests
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
create policy "quests: dm deletes" on quests
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- quest_updates (DM-owned)
drop policy if exists "quest journal: members read" on quest_updates;
drop policy if exists "quest journal: dm writes" on quest_updates;
drop policy if exists "quest journal: dm deletes" on quest_updates;
create policy "quest journal: members read" on quest_updates
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "quest journal: dm writes" on quest_updates
  for insert to authenticated with check (is_campaign_dm(campaign_id));
create policy "quest journal: dm deletes" on quest_updates
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- notes (members write their own; private = author only)
drop policy if exists "notes: members read (private = author only)" on notes;
drop policy if exists "notes: members write as themselves" on notes;
drop policy if exists "notes: author edits" on notes;
drop policy if exists "notes: author or dm deletes" on notes;
create policy "notes: members read (private = author only)" on notes
  for select to authenticated
  using (is_campaign_member(campaign_id) and (not is_private or author_email = my_email()));
create policy "notes: members write as themselves" on notes
  for insert to authenticated
  with check (is_campaign_member(campaign_id) and author_email = my_email());
create policy "notes: author edits" on notes
  for update to authenticated
  using (author_email = my_email() and is_campaign_member(campaign_id))
  with check (author_email = my_email() and is_campaign_member(campaign_id));
create policy "notes: author or dm deletes" on notes
  for delete to authenticated
  using (author_email = my_email() or is_campaign_dm(campaign_id));

-- codex_entries (members add; author or dm edits)
drop policy if exists "codex: members read" on codex_entries;
drop policy if exists "codex: members add as themselves" on codex_entries;
drop policy if exists "codex: author or dm edits" on codex_entries;
drop policy if exists "codex: author or dm deletes" on codex_entries;
create policy "codex: members read" on codex_entries
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "codex: members add as themselves" on codex_entries
  for insert to authenticated
  with check (is_campaign_member(campaign_id) and author_email = my_email());
create policy "codex: author or dm edits" on codex_entries
  for update to authenticated
  using (author_email = my_email() or is_campaign_dm(campaign_id))
  with check ((author_email = my_email() or is_campaign_dm(campaign_id)) and is_campaign_member(campaign_id));
create policy "codex: author or dm deletes" on codex_entries
  for delete to authenticated using (author_email = my_email() or is_campaign_dm(campaign_id));

-- codex_notes (members add; author or dm deletes)
drop policy if exists "codex intel: members read" on codex_notes;
drop policy if exists "codex intel: members add as themselves" on codex_notes;
drop policy if exists "codex intel: author or dm deletes" on codex_notes;
create policy "codex intel: members read" on codex_notes
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "codex intel: members add as themselves" on codex_notes
  for insert to authenticated
  with check (is_campaign_member(campaign_id) and author_email = my_email());
create policy "codex intel: author or dm deletes" on codex_notes
  for delete to authenticated using (author_email = my_email() or is_campaign_dm(campaign_id));

-- maps (DM-owned)
drop policy if exists "maps: members read" on maps;
drop policy if exists "maps: dm writes" on maps;
drop policy if exists "maps: dm edits" on maps;
drop policy if exists "maps: dm deletes" on maps;
create policy "maps: members read" on maps
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "maps: dm writes" on maps
  for insert to authenticated with check (is_campaign_dm(campaign_id));
create policy "maps: dm edits" on maps
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
create policy "maps: dm deletes" on maps
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- party_characters (DM-owned roster)
drop policy if exists "party: members read" on party_characters;
drop policy if exists "party: dm writes" on party_characters;
drop policy if exists "party: dm edits" on party_characters;
drop policy if exists "party: dm deletes" on party_characters;
create policy "party: members read" on party_characters
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "party: dm writes" on party_characters
  for insert to authenticated with check (is_campaign_dm(campaign_id));
create policy "party: dm edits" on party_characters
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
create policy "party: dm deletes" on party_characters
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- rolls (read within campaign; inserts only via roll functions; dm cleans up)
drop policy if exists "rolls: members read" on rolls;
drop policy if exists "rolls: dm sweeps the table" on rolls;
create policy "rolls: members read" on rolls
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "rolls: dm sweeps the table" on rolls
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- roll_presets (personal, within a campaign)
drop policy if exists "presets: own reads" on roll_presets;
drop policy if exists "presets: own writes" on roll_presets;
drop policy if exists "presets: own edits" on roll_presets;
drop policy if exists "presets: own deletes" on roll_presets;
create policy "presets: own reads" on roll_presets
  for select to authenticated using (owner_email = my_email() and is_campaign_member(campaign_id));
create policy "presets: own writes" on roll_presets
  for insert to authenticated with check (owner_email = my_email() and is_campaign_member(campaign_id));
create policy "presets: own edits" on roll_presets
  for update to authenticated using (owner_email = my_email()) with check (owner_email = my_email());
create policy "presets: own deletes" on roll_presets
  for delete to authenticated using (owner_email = my_email());

-- characters (PORTABLE: owned by the player; visible to campaigns they're in)
drop policy if exists "characters: members read" on characters;
drop policy if exists "characters: members write their own" on characters;
drop policy if exists "characters: owner or dm edits" on characters;
drop policy if exists "characters: owner or dm deletes" on characters;
create policy "characters: owner or shared-campaign members read" on characters
  for select to authenticated using (
    owner_email = my_email()
    or exists (
      select 1 from campaign_characters cc
      where cc.character_id = characters.id and is_campaign_member(cc.campaign_id)
    )
  );
create policy "characters: players create their own" on characters
  for insert to authenticated with check (owner_email = my_email());
create policy "characters: owner edits" on characters
  for update to authenticated using (owner_email = my_email()) with check (owner_email = my_email());
create policy "characters: owner deletes" on characters
  for delete to authenticated using (owner_email = my_email());

-- encounters (DM-owned, within a campaign)
drop policy if exists "encounters: members read" on encounters;
drop policy if exists "encounters: dm creates" on encounters;
drop policy if exists "encounters: dm edits" on encounters;
drop policy if exists "encounters: dm deletes" on encounters;
create policy "encounters: members read" on encounters
  for select to authenticated using (is_campaign_member(campaign_id));
create policy "encounters: dm creates" on encounters
  for insert to authenticated with check (is_campaign_dm(campaign_id));
create policy "encounters: dm edits" on encounters
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
create policy "encounters: dm deletes" on encounters
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- tokens (campaign-scoped; players move only their own PC token)
drop policy if exists "tokens: members see (unless hidden)" on tokens;
drop policy if exists "tokens: dm places" on tokens;
drop policy if exists "tokens: dm or the pc's player updates" on tokens;
drop policy if exists "tokens: dm removes" on tokens;
create policy "tokens: members see (unless hidden)" on tokens
  for select to authenticated
  using (is_campaign_member(campaign_id) and (not hidden or is_campaign_dm(campaign_id)));
create policy "tokens: dm places" on tokens
  for insert to authenticated with check (is_campaign_dm(campaign_id));
create policy "tokens: dm or the pc's player updates" on tokens
  for update to authenticated
  using (is_campaign_dm(campaign_id) or (kind = 'pc' and owns_token_character(character_id)))
  with check (is_campaign_dm(campaign_id) or (kind = 'pc' and owns_token_character(character_id)));
create policy "tokens: dm removes" on tokens
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- ── campaign-aware dice functions ────────────────────────────
-- Rolls now belong to a campaign; only its members may roll into it.
create or replace function roll_dice(p_campaign uuid, p_label text, p_spec jsonb, p_modifier int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d jsonb; results int[]; all_dice jsonb := '[]'::jsonb; total int := 0;
  sides int; cnt int; total_count int := 0; new_row rolls;
begin
  if not is_campaign_member(p_campaign) then raise exception 'Not a member of this campaign'; end if;
  if p_modifier is null or p_modifier < -99 or p_modifier > 99 then raise exception 'Modifier out of range'; end if;
  if p_spec is null or jsonb_typeof(p_spec) <> 'array' or jsonb_array_length(p_spec) = 0 then raise exception 'Nothing to roll'; end if;
  for d in select * from jsonb_array_elements(p_spec) loop
    sides := (d->>'sides')::int; cnt := (d->>'count')::int;
    if sides not in (4,6,8,10,12,20,100) then raise exception 'Unknown die: d%', sides; end if;
    if cnt is null or cnt < 1 then raise exception 'Bad dice count'; end if;
    total_count := total_count + cnt;
    if total_count > 40 then raise exception 'Too many dice (max 40 per roll)'; end if;
    results := array(select 1 + floor(random() * sides)::int from generate_series(1, cnt));
    total := total + (select sum(x)::int from unnest(results) x);
    all_dice := all_dice || jsonb_build_array(jsonb_build_object('sides', sides, 'count', cnt, 'results', to_jsonb(results)));
  end loop;
  total := total + p_modifier;
  insert into rolls (campaign_id, roller_email, label, dice, modifier, total)
  values (p_campaign, my_email(), left(coalesce(p_label, ''), 60), all_dice, p_modifier, total)
  returning * into new_row;
  return to_jsonb(new_row);
end $$;
revoke execute on function roll_dice(uuid, text, jsonb, int) from public, anon;
grant execute on function roll_dice(uuid, text, jsonb, int) to authenticated;
-- retire the old campaign-less signature so nothing calls it unscoped
drop function if exists roll_dice(text, jsonb, int);

create or replace function roll_check(p_campaign uuid, p_label text, p_modifier int, p_mode text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r1 int; r2 int; kept int; dice_json jsonb; new_row rolls;
begin
  if not is_campaign_member(p_campaign) then raise exception 'Not a member of this campaign'; end if;
  if p_modifier is null or p_modifier < -99 or p_modifier > 99 then raise exception 'Modifier out of range'; end if;
  if p_mode not in ('normal','adv','dis') then raise exception 'Bad roll mode'; end if;
  r1 := 1 + floor(random() * 20)::int;
  if p_mode = 'normal' then
    kept := r1;
    dice_json := jsonb_build_array(jsonb_build_object('sides',20,'count',1,'results',jsonb_build_array(r1)));
  else
    r2 := 1 + floor(random() * 20)::int;
    kept := case when p_mode='adv' then greatest(r1,r2) else least(r1,r2) end;
    dice_json := jsonb_build_array(jsonb_build_object('sides',20,'count',2,'results',jsonb_build_array(r1,r2),
      'keep', case when p_mode='adv' then 'high' else 'low' end));
  end if;
  insert into rolls (campaign_id, roller_email, label, dice, modifier, total)
  values (p_campaign, my_email(), left(coalesce(p_label,''),60), dice_json, p_modifier, kept + p_modifier)
  returning * into new_row;
  return to_jsonb(new_row);
end $$;
revoke execute on function roll_check(uuid, text, int, text) from public, anon;
grant execute on function roll_check(uuid, text, int, text) to authenticated;
drop function if exists roll_check(text, int, text);

-- ═════════════════════════════════════════════════════════════
--  AI image generation — cost-safe by construction.
--  (mirrors supabase/migrations/20260916130000_ai_images.sql;
--   see docs/AI-IMAGES.md. Safe to run more than once.)
--
--  The money-critical caps are enforced HERE, atomically, before
--  any paid provider call: a per-DM/month cap and a global/month
--  cap in ai_image_config; every attempt logged in ai_image_log;
--  ai_reserve_image() counts-and-inserts under a per-month
--  advisory lock so concurrent calls can't exceed the cap; a
--  'failed' row never counts against quota. The ultimate ceiling
--  is the PREPAID CREDIT the owner sets at the provider.
-- ═════════════════════════════════════════════════════════════

create table if not exists ai_image_config (
  id boolean primary key default true,
  per_dm_monthly_cap  int not null default 50,
  global_monthly_cap  int not null default 5000,
  updated_at timestamptz not null default now(),
  constraint ai_image_config_singleton check (id = true)
);
insert into ai_image_config (id) values (true) on conflict (id) do nothing;
alter table ai_image_config enable row level security;
drop policy if exists "ai config: readable" on ai_image_config;
create policy "ai config: readable" on ai_image_config
  for select to authenticated using (true);

create table if not exists ai_image_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references campaigns(id) on delete cascade,
  dm_email     text not null,
  ym           text not null,
  kind         text not null check (kind in ('map','portrait')),
  prompt       text not null default '',
  storage_path text,
  status       text not null default 'pending' check (status in ('pending','done','failed')),
  created_at   timestamptz not null default now()
);
create index if not exists ai_image_log_dm_ym_live_idx
  on ai_image_log (dm_email, ym) where status <> 'failed';
create index if not exists ai_image_log_ym_live_idx
  on ai_image_log (ym) where status <> 'failed';
create index if not exists ai_image_log_campaign_idx on ai_image_log (campaign_id);
alter table ai_image_log enable row level security;
drop policy if exists "ai log: members read" on ai_image_log;
create policy "ai log: members read" on ai_image_log
  for select to authenticated using (is_campaign_member(campaign_id));

create or replace function ai_reserve_image(p_campaign uuid, p_kind text, p_prompt text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ym          text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_email       text := my_email();
  v_per_dm      int;
  v_global      int;
  v_dm_count    int;
  v_global_cnt  int;
  v_id          uuid;
begin
  if v_email = '' then raise exception 'Must be signed in'; end if;
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a DM of this campaign can generate images';
  end if;
  if p_kind not in ('map','portrait') then
    raise exception 'Unknown image kind';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai_image_reserve:' || v_ym, 0));
  select per_dm_monthly_cap, global_monthly_cap
    into v_per_dm, v_global
    from ai_image_config where id = true;
  if v_per_dm is null or v_global is null then
    raise exception 'AI image budget is not configured';
  end if;
  select count(*) into v_dm_count
    from ai_image_log
   where dm_email = v_email and ym = v_ym and status <> 'failed';
  if v_dm_count >= v_per_dm then
    raise exception 'DM monthly limit reached';
  end if;
  select count(*) into v_global_cnt
    from ai_image_log
   where ym = v_ym and status <> 'failed';
  if v_global_cnt >= v_global then
    raise exception 'Global monthly AI budget reached';
  end if;
  insert into ai_image_log (campaign_id, dm_email, ym, kind, prompt, status)
    values (p_campaign, v_email, v_ym, p_kind, left(coalesce(p_prompt, ''), 2000), 'pending')
    returning id into v_id;
  return v_id;
end $$;
revoke execute on function ai_reserve_image(uuid, text, text) from public, anon;
grant  execute on function ai_reserve_image(uuid, text, text) to authenticated, service_role;

create or replace function ai_complete_image(p_id uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update ai_image_log
     set status = 'done', storage_path = p_path
   where id = p_id and status = 'pending'
     and (dm_email = my_email() or auth.role() = 'service_role');
  if not found then
    raise exception 'Reservation not found, not yours, or already finalized';
  end if;
end $$;
revoke execute on function ai_complete_image(uuid, text) from public, anon;
grant  execute on function ai_complete_image(uuid, text) to authenticated, service_role;

create or replace function ai_fail_image(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update ai_image_log
     set status = 'failed'
   where id = p_id and status = 'pending'
     and (dm_email = my_email() or auth.role() = 'service_role');
end $$;
revoke execute on function ai_fail_image(uuid) from public, anon;
grant  execute on function ai_fail_image(uuid) to authenticated, service_role;

create or replace function ai_usage()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ym    text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_email text := my_email();
  v_per   int;
  v_glob  int;
  v_used  int;
  v_gused int;
begin
  select per_dm_monthly_cap, global_monthly_cap into v_per, v_glob
    from ai_image_config where id = true;
  select count(*) into v_used  from ai_image_log
    where dm_email = v_email and ym = v_ym and status <> 'failed';
  select count(*) into v_gused from ai_image_log
    where ym = v_ym and status <> 'failed';
  return jsonb_build_object(
    'ym', v_ym, 'used', v_used, 'cap', v_per,
    'remaining', greatest(0, coalesce(v_per, 0) - v_used),
    'global_used', v_gused, 'global_cap', v_glob);
end $$;
revoke execute on function ai_usage() from public, anon;
grant  execute on function ai_usage() to authenticated, service_role;

insert into storage.buckets (id, name, public)
values ('ai-art', 'ai-art', false)
on conflict (id) do nothing;
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg','image/png','image/webp']
 where id = 'ai-art';

create or replace function can_read_ai_art(p text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare seg text := split_part(p, '/', 1); cid uuid;
begin
  begin cid := seg::uuid; exception when others then return false; end;
  return is_campaign_member(cid);
end $$;

drop policy if exists "ai-art: members read own campaign" on storage.objects;
create policy "ai-art: members read own campaign" on storage.objects
  for select to authenticated
  using (bucket_id = 'ai-art' and can_read_ai_art(name));


-- ═══ Accounts, invite links, and DM gating (mirrored from 20260916120000_accounts_invites.sql) ═══
-- ═══════════════════════════════════════════════════════════
--  Accounts, invite links, and DM gating.
--
--  • While you're testing, ONLY allow-listed emails may create a
--    campaign (become a DM). Everyone else signs up as a player and
--    joins a campaign through an invite link. Later, a paid
--    subscription just adds the buyer's email to campaign_creators.
--  • A DM mints a random invite link for their campaign; a friend
--    opens it, creates an account, and is added to THAT campaign as
--    a player. Tokens are 128-bit random, revocable, and can expire
--    or cap their uses.
--
--  Security: every rule below is enforced in the database (RLS +
--  SECURITY DEFINER functions), never in the browser.
-- ═══════════════════════════════════════════════════════════

create extension if not exists pgcrypto;   -- gen_random_bytes for tokens

-- ── Who may create campaigns (i.e. be a DM) ──────────────────
create table if not exists campaign_creators (
  email text primary key,
  added_at timestamptz not null default now()
);
alter table campaign_creators enable row level security;
-- No client policies: the table is consulted only through the
-- SECURITY DEFINER helpers below, so nobody can read or edit the
-- allow-list from the browser.

-- ⚔️ Seed the owner. EDIT this to the email you sign in with.
insert into campaign_creators (email) values ('mitchel.shepherd98@gmail.com')
  on conflict do nothing;

create or replace function can_create_campaign() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from campaign_creators where lower(email) = my_email())
$$;
revoke execute on function can_create_campaign() from public, anon;
grant execute on function can_create_campaign() to authenticated;

-- Gate campaign creation. Replaces the open create_campaign so a
-- random signup can't spin up campaigns while you're testing.
-- (drop first: the prior version may return a different type)
drop function if exists create_campaign(text);
create or replace function create_campaign(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c campaigns;
begin
  if not can_create_campaign() then
    raise exception 'Your account is not allowed to create campaigns yet.';
  end if;
  insert into campaigns (name, owner_email)
    values (coalesce(nullif(trim(p_name), ''), 'New Campaign'), my_email())
    returning * into c;
  insert into campaign_members (campaign_id, email, role, display_name)
    values (c.id, my_email(), 'dm', split_part(my_email(), '@', 1))
    on conflict do nothing;
  return to_jsonb(c);
end $$;
revoke execute on function create_campaign(text) from public, anon;
grant execute on function create_campaign(text) to authenticated;

-- ── Invite links ─────────────────────────────────────────────
create table if not exists campaign_invites (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(16), 'hex'),
  role text not null default 'player' check (role in ('player', 'dm')),
  created_by text not null default my_email(),
  created_at timestamptz not null default now(),
  expires_at timestamptz,          -- null = never
  max_uses int,                    -- null = unlimited
  uses int not null default 0,
  revoked boolean not null default false
);
create index if not exists campaign_invites_campaign_idx on campaign_invites(campaign_id);
alter table campaign_invites enable row level security;

-- Only a DM of the campaign can mint / see / revoke its invites.
drop policy if exists "invites: dm reads" on campaign_invites;
create policy "invites: dm reads" on campaign_invites
  for select to authenticated using (is_campaign_dm(campaign_id));
drop policy if exists "invites: dm creates" on campaign_invites;
create policy "invites: dm creates" on campaign_invites
  for insert to authenticated with check (is_campaign_dm(campaign_id) and created_by = my_email());
drop policy if exists "invites: dm updates" on campaign_invites;
create policy "invites: dm updates" on campaign_invites
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
drop policy if exists "invites: dm deletes" on campaign_invites;
create policy "invites: dm deletes" on campaign_invites
  for delete to authenticated using (is_campaign_dm(campaign_id));

-- Mint an invite for a campaign you DM. Returns the new row (incl. token).
create or replace function create_campaign_invite(
  p_campaign uuid, p_role text default 'player',
  p_expires timestamptz default null, p_max_uses int default null)
returns campaign_invites language plpgsql security definer set search_path = public as $$
declare inv campaign_invites;
begin
  if not is_campaign_dm(p_campaign) then
    raise exception 'Only a DM of this campaign can create invites.';
  end if;
  if p_role not in ('player', 'dm') then raise exception 'Bad invite role.'; end if;
  insert into campaign_invites (campaign_id, role, created_by, expires_at, max_uses)
    values (p_campaign, p_role, my_email(), p_expires, p_max_uses)
    returning * into inv;
  return inv;
end $$;
revoke execute on function create_campaign_invite(uuid, text, timestamptz, int) from public, anon;
grant execute on function create_campaign_invite(uuid, text, timestamptz, int) to authenticated;

-- Public, read-only peek at a token so the join page can show the
-- campaign name BEFORE someone signs up. Leaks only name + validity
-- for a correctly-guessed 128-bit token; never the roster or content.
create or replace function invite_info(p_token text)
returns table(campaign_id uuid, campaign_name text, role text, valid boolean)
language sql stable security definer set search_path = public as $$
  select i.campaign_id, c.name, i.role,
         (not i.revoked
           and (i.expires_at is null or i.expires_at > now())
           and (i.max_uses is null or i.uses < i.max_uses)) as valid
  from campaign_invites i
  join campaigns c on c.id = i.campaign_id
  where i.token = p_token
$$;
grant execute on function invite_info(text) to anon, authenticated;

-- Redeem a token: add the signed-in user to the campaign as the
-- invite's role. Locks the row so concurrent redeems can't overrun
-- max_uses. Idempotent if they're already a member.
create or replace function redeem_invite(p_token text, p_display_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv campaign_invites; nm text;
begin
  select * into inv from campaign_invites where token = p_token for update;
  if inv.id is null then raise exception 'This invite link is invalid.'; end if;
  if inv.revoked then raise exception 'This invite link has been turned off.'; end if;
  if inv.expires_at is not null and inv.expires_at <= now() then raise exception 'This invite link has expired.'; end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then raise exception 'This invite link has reached its limit.'; end if;

  if exists (select 1 from campaign_members where campaign_id = inv.campaign_id and lower(email) = my_email()) then
    return jsonb_build_object('campaign_id', inv.campaign_id, 'already', true);
  end if;

  nm := coalesce(nullif(trim(p_display_name), ''), split_part(my_email(), '@', 1));
  insert into campaign_members (campaign_id, email, role, display_name)
    values (inv.campaign_id, my_email(), inv.role, nm);
  update campaign_invites set uses = uses + 1 where id = inv.id;
  return jsonb_build_object('campaign_id', inv.campaign_id, 'already', false);
end $$;
revoke execute on function redeem_invite(text, text) from public, anon;
grant execute on function redeem_invite(text, text) to authenticated;
