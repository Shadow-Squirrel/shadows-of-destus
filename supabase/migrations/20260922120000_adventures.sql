-- ═════════════════════════════════════════════════════════════
--  ADVENTURES — a campaign's saved AI DM-prep documents. Each row is
--  ONE adventure the DM generated (or wrote): a named location, an
--  ordered set of scenes (combat / puzzle / social / exploration) each
--  with boxed read-aloud text and DM notes, a cast of NPCs, suggested
--  treasure, and an XP/difficulty budget note. It's a prep document the
--  DM reads at the table; combat scenes can be staged onto the Battle
--  map (VTT), reusing the token layout the ⚡ AI-prep accelerator built.
--
--  The whole adventure lives in one `data` jsonb blob (the shape the
--  browser understands, see js/pages/adventures.js) so it can grow new
--  fields without a migration. Same ownership as the homebrew content:
--  party members read, only a DM writes.
--
--  No AI-budget change: an adventure plan is reserved as kind 'monster'
--  (the plan-encounter convention) against the shared ai_text budget,
--  so no ai_text_log constraint needs widening.
--
--  Safe to run more than once.
-- ═════════════════════════════════════════════════════════════

create table if not exists adventures (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  title       text not null default 'New adventure',
  location    text not null default '',
  data        jsonb not null default '{}'::jsonb,
  created_by  text not null default my_email(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists adventures_campaign_idx on adventures (campaign_id, created_at desc);
alter table adventures enable row level security;

drop policy if exists "adv: members read" on adventures;
create policy "adv: members read" on adventures
  for select to authenticated using (is_campaign_member(campaign_id));
drop policy if exists "adv: dm writes" on adventures;
create policy "adv: dm writes" on adventures
  for insert to authenticated with check (is_campaign_dm(campaign_id));
drop policy if exists "adv: dm edits" on adventures;
create policy "adv: dm edits" on adventures
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
drop policy if exists "adv: dm deletes" on adventures;
create policy "adv: dm deletes" on adventures
  for delete to authenticated using (is_campaign_dm(campaign_id));

create or replace function touch_adventure() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists adventures_touch on adventures;
create trigger adventures_touch before update on adventures
  for each row execute function touch_adventure();
