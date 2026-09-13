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
