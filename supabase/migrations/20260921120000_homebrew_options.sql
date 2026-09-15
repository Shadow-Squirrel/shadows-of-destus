-- ═════════════════════════════════════════════════════════════
--  Homebrew ORIGINS — a campaign's shared player options: custom
--  races, subclasses (and, later, classes). One table, keyed by
--  `kind`, since they're all small jsonb blobs the character model
--  already understands (see js/dnd/rules.js raceInfo / the custom
--  subclass path). Same ownership as the other homebrew content:
--  party members read, only a DM writes.
--
--   • race     data: {abilityBonuses:{}, speed, size, traits:[{name,desc}],
--                     languages:[]}                — raceInfo() consumes this
--   • subclass data: {className, notes}            — added as a subclass feature
--   • class    data: {…}                            — reserved for a later pass
--
--  No AI-budget change: the shared ai_text budget already accepts
--  kinds 'race', 'subclass' and 'class' (widened in ..._homebrew_spells.sql).
--
--  Safe to run more than once.
-- ═════════════════════════════════════════════════════════════

create table if not exists homebrew_options (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  kind        text not null check (kind in ('race','subclass','class')),
  name        text not null default 'New option',
  data        jsonb not null default '{}'::jsonb,
  created_by  text not null default my_email(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists homebrew_options_campaign_idx on homebrew_options (campaign_id, kind);
alter table homebrew_options enable row level security;

drop policy if exists "hbopt: members read" on homebrew_options;
create policy "hbopt: members read" on homebrew_options
  for select to authenticated using (is_campaign_member(campaign_id));
drop policy if exists "hbopt: dm writes" on homebrew_options;
create policy "hbopt: dm writes" on homebrew_options
  for insert to authenticated with check (is_campaign_dm(campaign_id));
drop policy if exists "hbopt: dm edits" on homebrew_options;
create policy "hbopt: dm edits" on homebrew_options
  for update to authenticated using (is_campaign_dm(campaign_id)) with check (is_campaign_dm(campaign_id));
drop policy if exists "hbopt: dm deletes" on homebrew_options;
create policy "hbopt: dm deletes" on homebrew_options
  for delete to authenticated using (is_campaign_dm(campaign_id));

create or replace function touch_homebrew_option() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists homebrew_options_touch on homebrew_options;
create trigger homebrew_options_touch before update on homebrew_options
  for each row execute function touch_homebrew_option();
