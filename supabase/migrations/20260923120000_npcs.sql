-- ═════════════════════════════════════════════════════════════
--  NPCs — the DM's private cast of characters. Each row is one NPC
--  the DM generated or wrote: name + a `data` blob (race, role,
--  personality, SECRET, voice, and a small inventory) + an optional
--  AI portrait. Because NPCs carry secrets the players must NOT see,
--  this table is DM-ONLY: only the campaign's DM can read or write it
--  (the database is the guard, not the browser).
--
--  When the DM is ready, "Reveal to Codex" creates a normal
--  codex_entries row with just the public-facing details + portrait,
--  which the whole party can see. codex_entry_id links the two.
--
--  AI drafting reuses the shared generate-homebrew function (kind
--  'npc') and the shared AI *text* budget; the portrait reuses the AI
--  *image* budget (kind 'portrait'). To allow the new text kind, we
--  widen the ai_text_log check constraint to include 'npc'. We also
--  add art_path to codex_entries so a revealed NPC's portrait (which
--  lives in the private 'ai-art' bucket) can be shown in the Codex.
--
--  Safe to run more than once.
-- ═════════════════════════════════════════════════════════════

-- 1. let the shared AI text budget log an 'npc' generation
alter table ai_text_log drop constraint if exists ai_text_log_kind_check;
alter table ai_text_log add constraint ai_text_log_kind_check
  check (kind in ('monster','spell','item','feat','background','race','subclass','class','encounter','npc'));

-- 2. codex entries can carry an AI portrait (private 'ai-art' bucket)
alter table codex_entries add column if not exists art_path text;

-- 3. the DM-only NPC roster
create table if not exists campaign_npcs (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references campaigns(id) on delete cascade,
  name           text not null default 'New NPC',
  data           jsonb not null default '{}'::jsonb,
  art_path       text,
  codex_entry_id uuid references codex_entries(id) on delete set null,
  created_by     text not null default my_email(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists campaign_npcs_campaign_idx on campaign_npcs (campaign_id, created_at desc);
alter table campaign_npcs enable row level security;

-- DM-only on BOTH read and write — secrets never reach players.
drop policy if exists "npcs: dm reads" on campaign_npcs;
create policy "npcs: dm reads" on campaign_npcs
  for select to authenticated using (is_campaign_dm(campaign_id));
drop policy if exists "npcs: dm writes" on campaign_npcs;
create policy "npcs: dm writes" on campaign_npcs
  for insert to authenticated with check (is_campaign_dm(campaign_id));
drop policy if exists "npcs: dm edits" on campaign_npcs;
create policy "npcs: dm edits" on campaign_npcs
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
drop policy if exists "npcs: dm deletes" on campaign_npcs;
create policy "npcs: dm deletes" on campaign_npcs
  for delete to authenticated using (is_campaign_dm(campaign_id));

create or replace function touch_campaign_npc() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists campaign_npcs_touch on campaign_npcs;
create trigger campaign_npcs_touch before update on campaign_npcs
  for each row execute function touch_campaign_npc();
