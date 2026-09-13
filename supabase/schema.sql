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

alter publication supabase_realtime add table rolls;

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
  with check (is_member());
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

-- live sync for every open battle map
alter publication supabase_realtime add table encounters;
alter publication supabase_realtime add table tokens;
